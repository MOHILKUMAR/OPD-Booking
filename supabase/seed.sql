-- MediQueue development seed.
-- DEMO DATA ONLY: fictional hospital and doctors, no real patient data, no invented
-- qualifications (qualifications/bio are left NULL for the hospital to fill in).
-- Staff logins are not created here; use scripts/create-staff-user.mjs.
-- Safe to run more than once.

insert into public.hospitals (
  id, slug, name, tagline, address_line, city, state, postal_code, phone, emergency_phone, email,
  timezone, operating_hours, visit_instructions, booking_window_days, cancel_cutoff_minutes,
  duplicate_policy, max_bookings_per_phone_per_day, require_patient_age, default_booking_fee_paise,
  online_payments_enabled
) values (
  '00000000-0000-4000-8000-000000000001',
  'demo-hospital',
  'MediQueue Demo Hospital',
  'Demo data for development - not a real hospital',
  '1 Example Road, Demo Nagar',
  'Bengaluru', 'Karnataka', '560001',
  '+91 80 0000 0000', '108', 'opd@example.com',
  'Asia/Kolkata',
  '[{"label":"OPD, Mon - Sat","hours":"09:00 - 13:00, 17:00 - 20:00"},{"label":"Emergency","hours":"24 x 7"}]',
  'Arrive 15 minutes before your expected turn. Show your token number at the OPD reception desk to check in.',
  1, 60, 'PHONE', 3, true, 0, false
) on conflict (id) do nothing;

insert into public.departments (id, hospital_id, name, description, sort_order) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'General Medicine', 'Adult outpatient consultations.', 1),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 'Paediatrics', 'Outpatient care for children.', 2),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001', 'Orthopaedics', 'Bones, joints and muscles.', 3),
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000001', 'ENT', 'Ear, nose and throat.', 4),
  ('00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-000000000001', 'Dermatology', 'Skin, hair and nails.', 5)
on conflict (id) do nothing;

insert into public.doctors (id, hospital_id, department_id, full_name, specialty, room_no, consultation_fee_paise, can_self_manage_session, sort_order) values
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'Dr. Asha Rao (Demo)', 'General Physician', '101', 30000, true, 1),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'Dr. Vikram Iyer (Demo)', 'General Physician', '102', 30000, false, 2),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102', 'Dr. Meera Nair (Demo)', 'Paediatrician', '201', 40000, true, 3),
  ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000103', 'Dr. Arjun Mehta (Demo)', 'Orthopaedic Surgeon', '301', 50000, false, 4),
  ('00000000-0000-4000-8000-000000000205', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000104', 'Dr. Farah Khan (Demo)', 'ENT Specialist', '401', 40000, false, 5),
  ('00000000-0000-4000-8000-000000000206', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000105', 'Dr. Rohan Das (Demo)', 'Dermatologist', '501', 50000, false, 6)
on conflict (id) do nothing;

-- Shifts. Booking fee NULL = hospital default (0 = free booking). One shift charges a
-- booking fee to exercise the pay-at-hospital / online-payment paths.
insert into public.shifts (id, hospital_id, doctor_id, name, start_time, end_time, max_tokens, walkin_reserved, booking_cutoff_minutes, avg_consult_minutes, booking_fee_paise) values
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000201', 'Morning OPD', '09:00', '13:00', 40, 10, 30, 8, null),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000201', 'Evening OPD', '17:00', '20:00', 25, 5, 30, 8, null),
  ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000202', 'Morning OPD', '09:30', '13:30', 40, 10, 30, 8, null),
  ('00000000-0000-4000-8000-000000000304', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000203', 'Morning OPD', '10:00', '14:00', 30, 6, 30, 10, null),
  ('00000000-0000-4000-8000-000000000305', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000204', 'Afternoon OPD', '14:00', '17:00', 20, 4, 45, 12, 5000),
  ('00000000-0000-4000-8000-000000000306', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000205', 'Morning OPD', '09:00', '12:00', 25, 5, 30, 10, null),
  ('00000000-0000-4000-8000-000000000307', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000206', 'Evening OPD', '16:00', '19:00', 20, 4, 30, 12, null)
on conflict (id) do nothing;

-- Weekly schedules (0 = Sunday)
insert into public.doctor_schedules (hospital_id, doctor_id, shift_id, weekday, effective_from)
select '00000000-0000-4000-8000-000000000001', s.doctor_id, s.id, wd, date '2026-01-01'
from public.shifts s
cross join lateral unnest(
  case s.id
    when '00000000-0000-4000-8000-000000000301' then array[1, 2, 3, 4, 5, 6]
    when '00000000-0000-4000-8000-000000000302' then array[1, 3, 5]
    when '00000000-0000-4000-8000-000000000303' then array[1, 2, 3, 4, 5, 6]
    when '00000000-0000-4000-8000-000000000304' then array[1, 2, 3, 4, 5, 6]
    when '00000000-0000-4000-8000-000000000305' then array[2, 4, 6]
    when '00000000-0000-4000-8000-000000000306' then array[1, 2, 4, 5]
    when '00000000-0000-4000-8000-000000000307' then array[1, 3, 5]
  end
) as wd
where s.hospital_id = '00000000-0000-4000-8000-000000000001'
on conflict (shift_id, weekday, effective_from) do nothing;

insert into public.hospital_announcements (id, hospital_id, kind, title, body, is_published, show_on_display) values
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000001', 'GENERAL',
   'Demo environment',
   'This is a demonstration hospital with fictional doctors. Do not enter real patient information.',
   true, true)
on conflict (id) do nothing;
