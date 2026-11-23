import { describe, expect, it, vi } from 'vitest';
import {
  nextDate,
  notificationDeliveryMessage,
  submitBookingForm,
  type BookingRequestPayload,
  type BookingRequestResult,
} from './booking';

function bookingFormData() {
  const data = new FormData();
  data.set('name', 'Synthetic Guest');
  data.set('phone', '+91 98765 43210');
  data.set('email', '');
  data.set('checkIn', '2027-01-04');
  data.set('checkOut', '2027-01-07');
  data.set('guests', '2');
  data.set('specialRequests', '');
  return data;
}

const bookingResult: BookingRequestResult = {
  reference: 'FSR-20270104-ABCD1234',
  status: 'REQUESTED',
  ownerNotification: { sent: false },
  emailNotification: { sent: false },
};

describe('booking request form handling', () => {
  it('resets only after a successful API response and returns the real reference', async () => {
    const resetForm = vi.fn();
    const createRequest = vi.fn(async (_payload: BookingRequestPayload) => bookingResult);

    const result = await submitBookingForm(bookingFormData(), createRequest, resetForm);

    expect(result.reference).toBe('FSR-20270104-ABCD1234');
    expect(result.status).toBe('REQUESTED');
    expect(createRequest).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Synthetic Guest',
      phone: '+91 98765 43210',
      email: '',
      guests: 2,
      whatsappOptIn: false,
    }));
    expect(resetForm).toHaveBeenCalledOnce();
  });

  it('preserves form values when API creation fails', async () => {
    const resetForm = vi.fn();
    const createRequest = vi.fn(async () => { throw new Error('network failure'); });

    await expect(submitBookingForm(bookingFormData(), createRequest, resetForm)).rejects.toThrow('network failure');
    expect(resetForm).not.toHaveBeenCalled();
  });

  it('shows a guest-friendly delivery note without provider diagnostics', () => {
    const message = notificationDeliveryMessage(bookingResult);
    expect(message).toContain('may contact you using the phone number you provided');
    expect(message).not.toContain('PROVIDER_NOT_CONFIGURED');
    expect(message).not.toContain('sent');
  });

  it('confirms owner notification only when the response says it was sent', () => {
    expect(notificationDeliveryMessage({
      ...bookingResult,
      ownerNotification: { sent: true },
      emailNotification: undefined,
    })).toContain('resort team has been notified');
  });

  it('sets the check-out minimum to the day after check-in', () => {
    expect(nextDate('2027-01-04')).toBe('2027-01-05');
    expect(nextDate('')).toBe('');
  });
});
