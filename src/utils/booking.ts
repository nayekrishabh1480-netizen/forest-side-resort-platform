export type BookingNotification = { sent: boolean } | undefined;

export type BookingRequestResult = {
  reference: string;
  status: string;
  ownerNotification?: BookingNotification;
  emailNotification?: BookingNotification;
  whatsappNotification?: BookingNotification;
};

export type BookingRequestPayload = {
  name: FormDataEntryValue | null;
  phone: FormDataEntryValue | null;
  email: FormDataEntryValue | null;
  checkIn: FormDataEntryValue | null;
  checkOut: FormDataEntryValue | null;
  guests: number;
  roomTypeId?: FormDataEntryValue;
  specialRequests: FormDataEntryValue | null;
  whatsappOptIn: boolean;
};

export function bookingPayloadFromForm(data: FormData): BookingRequestPayload {
  const roomTypeId = data.get('roomTypeId');
  return {
    name: data.get('name'),
    phone: data.get('phone'),
    email: data.get('email') || '',
    checkIn: data.get('checkIn'),
    checkOut: data.get('checkOut'),
    guests: Number(data.get('guests')),
    ...(roomTypeId ? { roomTypeId } : {}),
    specialRequests: data.get('specialRequests') || '',
    whatsappOptIn: data.get('whatsappOptIn') === 'on',
  };
}

/** Reset is deliberately called only after the request creator resolves successfully. */
export async function submitBookingForm<T extends BookingRequestResult>(
  data: FormData,
  createRequest: (payload: BookingRequestPayload) => Promise<T>,
  resetForm: () => void,
): Promise<T> {
  const result = await createRequest(bookingPayloadFromForm(data));
  resetForm();
  return result;
}

export function notificationDeliveryMessage(result: BookingRequestResult): string {
  const notifications = [result.ownerNotification, result.emailNotification, result.whatsappNotification].filter(
    (notification): notification is { sent: boolean } => Boolean(notification),
  );

  if (notifications.some((notification) => !notification.sent)) {
    return 'Your request was saved, but an automatic notification could not be delivered. The resort may contact you using the phone number you provided.';
  }
  if (result.ownerNotification?.sent) {
    return 'Your request was saved and the resort team has been notified.';
  }
  return 'Your request was saved. The resort will review it and contact you using the phone number you provided.';
}

export function nextDate(value: string): string {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}
