import nodemailer from 'nodemailer';
import { NotificationChannel, NotificationStatus, PrismaClient } from '@prisma/client';
import { config } from '../config.js';

const maskEmail = (value: string) => {
  const [name = '', host = ''] = value.split('@');
  return `${name.slice(0, 1)}***@${host}`;
};
const maskPhone = (value: string) => `${value.replace(/\D/g, '').slice(-2).padStart(2, '*').replace(/./g, '*')}${value.replace(/\D/g, '').slice(-2)}`;

export function createNotificationService(prisma: PrismaClient) {
  async function sendWhatsAppTemplate(input: { to: string; templateName: string; bodyParameters?: string[]; guestId?: string; bookingId?: string; optedIn: boolean; type: string }) {
    if (!input.optedIn) {
      await prisma.notificationLog.create({ data: { channel: NotificationChannel.WHATSAPP, status: NotificationStatus.SKIPPED, messageType: input.type, recipientMasked: maskPhone(input.to), guestId: input.guestId, bookingId: input.bookingId } });
      return { sent: false, reason: 'GUEST_OPT_IN_REQUIRED' as const };
    }
    if (!input.templateName) {
      await prisma.notificationLog.create({ data: { channel: NotificationChannel.WHATSAPP, status: NotificationStatus.SKIPPED, messageType: input.type, recipientMasked: maskPhone(input.to), guestId: input.guestId, bookingId: input.bookingId, failureCode: 'TEMPLATE_NOT_CONFIGURED' } });
      return { sent: false, reason: 'TEMPLATE_NOT_CONFIGURED' as const };
    }
    if (!config.hasWhatsApp) {
      await prisma.notificationLog.create({ data: { channel: NotificationChannel.WHATSAPP, status: NotificationStatus.SKIPPED, messageType: input.type, recipientMasked: maskPhone(input.to), guestId: input.guestId, bookingId: input.bookingId, failureCode: 'PROVIDER_NOT_CONFIGURED' } });
      return { sent: false, reason: 'PROVIDER_NOT_CONFIGURED' as const };
    }
    const template = input.templateName;
    const log = await prisma.notificationLog.create({ data: { channel: NotificationChannel.WHATSAPP, status: NotificationStatus.QUEUED, messageType: input.type, recipientMasked: maskPhone(input.to), guestId: input.guestId, bookingId: input.bookingId } });
    try {
      const response = await fetch(`https://graph.facebook.com/${config.WHATSAPP_API_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: 'POST', headers: { authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: input.to.replace(/\D/g, ''), type: 'template', template: { name: template, language: { code: 'en' }, ...(input.bodyParameters?.length ? { components: [{ type: 'body', parameters: input.bodyParameters.map((text) => ({ type: 'text', text })) }] } : {}) } }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error('PROVIDER_REJECTED');
      const result = await response.json() as { messages?: Array<{ id?: string }> };
      await prisma.notificationLog.update({ where: { id: log.id }, data: { status: NotificationStatus.SENT, sentAt: new Date(), providerMessageId: result.messages?.[0]?.id } });
      return { sent: true as const };
    } catch {
      await prisma.notificationLog.update({ where: { id: log.id }, data: { status: NotificationStatus.FAILED, failureCode: 'PROVIDER_UNAVAILABLE' } });
      return { sent: false as const, reason: 'PROVIDER_UNAVAILABLE' as const };
    }
  }

  async function sendBookingAcknowledgement(input: { to: string; reference: string; guestId: string; bookingId: string; optedIn: boolean }) {
    if (!config.hasSmtp) {
      await prisma.notificationLog.create({ data: { channel: NotificationChannel.EMAIL, status: NotificationStatus.SKIPPED, messageType: 'BOOKING_REQUEST_ACK', recipientMasked: maskEmail(input.to), guestId: input.guestId, bookingId: input.bookingId, failureCode: 'PROVIDER_NOT_CONFIGURED' } });
      return { sent: false, reason: 'PROVIDER_NOT_CONFIGURED' as const };
    }
    const log = await prisma.notificationLog.create({ data: { channel: NotificationChannel.EMAIL, status: NotificationStatus.QUEUED, messageType: 'BOOKING_REQUEST_ACK', recipientMasked: maskEmail(input.to), guestId: input.guestId, bookingId: input.bookingId } });
    try {
      const transporter = nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_SECURE, auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined });
      await transporter.sendMail({ from: config.EMAIL_FROM, to: input.to, subject: `Booking request ${input.reference}`, text: `We received booking request ${input.reference} for Forest Side Resort. This is a request only; the resort will contact you after reviewing availability. No reservation has been confirmed.` });
      await prisma.notificationLog.update({ where: { id: log.id }, data: { status: NotificationStatus.SENT, sentAt: new Date() } });
      return { sent: true as const };
    } catch {
      await prisma.notificationLog.update({ where: { id: log.id }, data: { status: NotificationStatus.FAILED, failureCode: 'PROVIDER_UNAVAILABLE' } });
      return { sent: false as const, reason: 'PROVIDER_UNAVAILABLE' as const };
    }
  }

  async function sendOwnerBookingNotification(input: { reference: string; guestName: string; phone: string; checkIn: string; checkOut: string; guests: number; guestId: string; bookingId: string }) {
    const to = config.OWNER_NOTIFICATION_EMAIL;
    if (!to || !config.hasSmtp) {
      await prisma.notificationLog.create({ data: { channel: NotificationChannel.EMAIL, status: NotificationStatus.SKIPPED, messageType: 'OWNER_BOOKING_REQUEST', recipientMasked: to ? maskEmail(to) : null, guestId: input.guestId, bookingId: input.bookingId, failureCode: 'OWNER_EMAIL_OR_SMTP_NOT_CONFIGURED' } });
      return { sent: false as const, reason: 'OWNER_EMAIL_OR_SMTP_NOT_CONFIGURED' as const };
    }
    const log = await prisma.notificationLog.create({ data: { channel: NotificationChannel.EMAIL, status: NotificationStatus.QUEUED, messageType: 'OWNER_BOOKING_REQUEST', recipientMasked: maskEmail(to), guestId: input.guestId, bookingId: input.bookingId } });
    try {
      const transporter = nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_SECURE, auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined });
      await transporter.sendMail({ from: config.EMAIL_FROM, to, subject: `Booking request ${input.reference}`, text: `A booking request needs review.\nReference: ${input.reference}\nGuest: ${input.guestName}\nPhone: ${input.phone}\nDates: ${input.checkIn} to ${input.checkOut}\nGuests: ${input.guests}\n\nSign in to the Forest Side Resort dashboard to review and confirm or decline the request.` });
      await prisma.notificationLog.update({ where: { id: log.id }, data: { status: NotificationStatus.SENT, sentAt: new Date() } });
      return { sent: true as const };
    } catch {
      await prisma.notificationLog.update({ where: { id: log.id }, data: { status: NotificationStatus.FAILED, failureCode: 'PROVIDER_UNAVAILABLE' } });
      return { sent: false as const, reason: 'PROVIDER_UNAVAILABLE' as const };
    }
  }

  async function sendBookingStatusUpdate(input: { to: string; reference: string; status: string; guestId: string; bookingId: string }) {
    if (!config.hasSmtp) {
      await prisma.notificationLog.create({ data: { channel: NotificationChannel.EMAIL, status: NotificationStatus.SKIPPED, messageType: `BOOKING_${input.status}`, recipientMasked: maskEmail(input.to), guestId: input.guestId, bookingId: input.bookingId, failureCode: 'PROVIDER_NOT_CONFIGURED' } });
      return { sent: false as const, reason: 'PROVIDER_NOT_CONFIGURED' as const };
    }
    const log = await prisma.notificationLog.create({ data: { channel: NotificationChannel.EMAIL, status: NotificationStatus.QUEUED, messageType: `BOOKING_${input.status}`, recipientMasked: maskEmail(input.to), guestId: input.guestId, bookingId: input.bookingId } });
    try {
      const transporter = nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_SECURE, auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined });
      const confirmed = input.status === 'CONFIRMED';
      await transporter.sendMail({ from: config.EMAIL_FROM, to: input.to, subject: `Booking request ${input.reference}: ${confirmed ? 'confirmed' : 'update'}`, text: confirmed ? `Your booking request ${input.reference} has been confirmed by Forest Side Resort. Please contact the resort if you need any details about your stay.` : `The resort has updated booking request ${input.reference} to ${input.status.toLowerCase()}. Please contact Forest Side Resort if you need assistance.` });
      await prisma.notificationLog.update({ where: { id: log.id }, data: { status: NotificationStatus.SENT, sentAt: new Date() } });
      return { sent: true as const };
    } catch {
      await prisma.notificationLog.update({ where: { id: log.id }, data: { status: NotificationStatus.FAILED, failureCode: 'PROVIDER_UNAVAILABLE' } });
      return { sent: false as const, reason: 'PROVIDER_UNAVAILABLE' as const };
    }
  }

  return { sendWhatsAppTemplate, sendBookingAcknowledgement, sendOwnerBookingNotification, sendBookingStatusUpdate };
}

export function emailMask(value: string) { return maskEmail(value); }
