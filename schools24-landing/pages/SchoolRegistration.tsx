import React, { useMemo, useState } from 'react';
import SEOMeta from '../components/SEOMeta';
import Footer from '../components/Footer';

const REGISTER_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  name: 'MySchools School Registration',
  url: 'https://MySchools.in/register',
  serviceType: 'School Management Software',
  provider: {
    '@type': 'Organization',
    name: 'MySchools',
    url: 'https://MySchools.in',
  },
  description: 'Register your school to get started with MySchools’s unified education operating system.',
  areaServed: 'IN',
};

const UDISE_CODE_REGEX = /^UDISE\d{6,14}$/;
const INTERNAL_SCHOOL_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{0,29}$/;

interface AdminForm {
  name: string;
  email: string;
  password: string;
}

interface DemoFormState {
  name: string;
  code: string;
  address: string;
  contact_email: string;
  admins: AdminForm[];
}

interface DemoRequestResponse {
  request: {
    request_number: number;
    school_name: string;
    created_at: string;
  };
}

const INITIAL_FORM: DemoFormState = {
  name: '',
  code: '',
  address: '',
  contact_email: '',
  admins: [{ name: '', email: '', password: '' }],
};

function validateSchoolCodeInput(raw: string): string | null {
  const value = raw.trim().toUpperCase();
  if (!value) return null;

  if (value.startsWith('UDISE')) {
    if (!UDISE_CODE_REGEX.test(value)) {
      return 'UDISE code must be in format UDISE followed by 6-14 digits';
    }
    return null;
  }

  if (!INTERNAL_SCHOOL_CODE_REGEX.test(value)) {
    return 'School code must use only A-Z, 0-9, underscore, or hyphen (max 30 chars)';
  }
  return null;
}

function validatePassword(password: string): string {
  const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
  if (!regex.test(password)) {
    return 'Password must be 8+ chars, incl. uppercase, lowercase, and a number.';
  }
  return '';
}

const SchoolRegistration: React.FC = () => {
  const [form, setForm] = useState<DemoFormState>(INITIAL_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const canAddAdmin = useMemo(() => form.admins.length < 5, [form.admins.length]);

  const updateAdmin = (index: number, field: keyof AdminForm, value: string) => {
    setForm((current) => {
      const admins = [...current.admins];
      admins[index] = { ...admins[index], [field]: value };
      return { ...current, admins };
    });
  };

  const validate = () => {
    const nextErrors: Record<string, string> = {};

    if (!form.name.trim()) nextErrors.name = 'School name is required';
    if (!form.contact_email.trim()) nextErrors.contact_email = 'Primary contact email is required';

    const schoolCodeError = validateSchoolCodeInput(form.code);
    if (schoolCodeError) nextErrors.code = schoolCodeError;

    form.admins.forEach((admin, index) => {
      if (!admin.name.trim()) nextErrors[`admin_${index}_name`] = 'Full name is required';
      if (!admin.email.trim()) nextErrors[`admin_${index}_email`] = 'Login email is required';
      if (!admin.password.trim()) {
        nextErrors[`admin_${index}_password`] = 'Password is required';
      } else {
        const passwordError = validatePassword(admin.password);
        if (passwordError) nextErrors[`admin_${index}_password`] = passwordError;
      }
    });

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSuccessMessage(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      const response = await fetch('/api/public/demo-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          code: form.code.trim().toUpperCase(),
          address: form.address.trim(),
          contact_email: form.contact_email.trim(),
          admins: form.admins.map((admin) => ({
            name: admin.name.trim(),
            email: admin.email.trim(),
            password: admin.password,
          })),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as Partial<DemoRequestResponse> & { error?: string };
      if (!response.ok) {
        if (payload.error === 'school_code_already_exists') {
          setErrors((current) => ({ ...current, code: 'This school code already exists in MySchools.' }));
          throw new Error('This school code already exists in MySchools.');
        }
        if (payload.error === 'email_already_exists') {
          throw new Error('One of the admin emails is already registered in MySchools.');
        }
        throw new Error(payload.error || 'Unable to submit your request right now.');
      }

      setForm(INITIAL_FORM);
      setErrors({});
      setSuccessMessage(`Request #${payload.request?.request_number ?? ''} received. Our super-admin team can now review it securely.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to submit your request right now.';
      setSuccessMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <SEOMeta
        title="Register Your School – Start with MySchools Free"
        description="Join hundreds of schools using MySchools. Connect admissions, operations, communication, and academic workflows in one platform. Register your institution today."
        path="/register"
        structuredData={REGISTER_SCHEMA}
      />
      <div className="min-h-screen w-full bg-white text-slate-900 selection:bg-blue-500 selection:text-white">
        <section className="relative overflow-hidden border-b border-slate-100 bg-[#f7f8fb]">
          <div className="absolute inset-x-0 top-0 h-52 bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.14),_transparent_46%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.12),_transparent_38%)]" />
          <div className="relative mx-auto max-w-5xl px-6 pb-16 pt-32 text-center">
            <span className="inline-flex rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-blue-700">
              Partner with MySchools
            </span>
            <h1 className="mt-6 text-5xl font-black tracking-tighter text-slate-900 md:text-7xl">
              Join the <span className="text-blue-600">Network.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-3xl text-lg font-medium leading-8 text-slate-500 md:text-xl">
              Submit the same school profile our super-admin dashboard uses, so your demo request can move straight into provisioning without rework.
            </p>
          </div>
        </section>

        <section className="bg-white px-6 py-16">
          <div className="mx-auto max-w-4xl rounded-[2.5rem] border border-slate-200 bg-white p-8 shadow-[0_30px_80px_rgba(15,23,42,0.08)] md:p-12">
            <div className="border-b border-slate-100 pb-8">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-blue-600">Demo request form</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900 md:text-4xl">School details</h2>
              <p className="mt-3 text-sm font-medium text-slate-500 md:text-base">
                This syncs directly with the super-admin Demo Requests queue. If the request is accepted, the same details are used to create your school in the dashboard.
              </p>
            </div>

            <form className="mt-8 space-y-8" onSubmit={handleSubmit}>
              <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-5">
                <h3 className="text-lg font-black tracking-tight text-slate-900">School intelligence</h3>
                <div className="mt-5 grid gap-6 md:grid-cols-2">
                  <label className="space-y-2 md:col-span-2">
                    <span className="text-sm font-bold uppercase tracking-widest text-slate-400">Registered Name</span>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                      placeholder="e.g. Springfield High School"
                      className={`w-full rounded-2xl border bg-white px-5 py-4 font-semibold text-slate-700 placeholder:text-slate-400 outline-none transition-all focus:border-blue-500 ${errors.name ? 'border-red-400' : 'border-slate-200'}`}
                    />
                    {errors.name && <p className="text-xs font-semibold text-red-500">{errors.name}</p>}
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-bold uppercase tracking-widest text-slate-400">Primary Contact Email</span>
                    <input
                      type="email"
                      value={form.contact_email}
                      onChange={(e) => setForm((current) => ({ ...current, contact_email: e.target.value }))}
                      placeholder="admin@springfield.edu"
                      className={`w-full rounded-2xl border bg-white px-5 py-4 font-semibold text-slate-700 placeholder:text-slate-400 outline-none transition-all focus:border-blue-500 ${errors.contact_email ? 'border-red-400' : 'border-slate-200'}`}
                    />
                    {errors.contact_email && <p className="text-xs font-semibold text-red-500">{errors.contact_email}</p>}
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-bold uppercase tracking-widest text-slate-400">School Code</span>
                    <input
                      type="text"
                      value={form.code}
                      onChange={(e) => setForm((current) => ({ ...current, code: e.target.value.toUpperCase() }))}
                      placeholder="e.g. UDISE123456"
                      className={`w-full rounded-2xl border bg-white px-5 py-4 font-semibold text-slate-700 placeholder:text-slate-400 outline-none transition-all focus:border-blue-500 ${errors.code ? 'border-red-400' : 'border-slate-200'}`}
                    />
                    {errors.code && <p className="text-xs font-semibold text-red-500">{errors.code}</p>}
                  </label>
                  <label className="space-y-2 md:col-span-2">
                    <span className="text-sm font-bold uppercase tracking-widest text-slate-400">Campus Address</span>
                    <input
                      type="text"
                      value={form.address}
                      onChange={(e) => setForm((current) => ({ ...current, address: e.target.value }))}
                      placeholder="123 Education Lane, City"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-5 py-4 font-semibold text-slate-700 placeholder:text-slate-400 outline-none transition-all focus:border-blue-500"
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-5">
                <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-lg font-black tracking-tight text-slate-900">Root administrators</h3>
                    <p className="mt-1 text-sm font-medium text-slate-500">Use the same admin accounts that should exist if the request is accepted.</p>
                  </div>
                  <button
                    type="button"
                    disabled={!canAddAdmin}
                    onClick={() => setForm((current) => ({ ...current, admins: [...current.admins, { name: '', email: '', password: '' }] }))}
                    className="rounded-full border border-blue-200 px-4 py-2 text-sm font-bold text-blue-700 transition-all hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Add Additional Admin
                  </button>
                </div>

                <div className="mt-5 space-y-4">
                  {form.admins.map((admin, index) => (
                    <div key={index} className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <p className="text-sm font-black uppercase tracking-widest text-slate-400">Admin {index + 1}</p>
                        {index > 0 && (
                          <button
                            type="button"
                            onClick={() => setForm((current) => ({ ...current, admins: current.admins.filter((_, adminIndex) => adminIndex !== index) }))}
                            className="rounded-full border border-red-200 px-3 py-1 text-xs font-bold text-red-600 transition-all hover:bg-red-50"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <div className="grid gap-4 md:grid-cols-3">
                        <label className="space-y-2">
                          <span className="text-sm font-bold uppercase tracking-widest text-slate-400">Full Name</span>
                          <input
                            type="text"
                            value={admin.name}
                            onChange={(e) => updateAdmin(index, 'name', e.target.value)}
                            placeholder="e.g. Principal Skinner"
                            className={`w-full rounded-2xl border bg-slate-50 px-5 py-4 font-semibold text-slate-700 placeholder:text-slate-400 outline-none transition-all focus:border-blue-500 ${errors[`admin_${index}_name`] ? 'border-red-400' : 'border-slate-200'}`}
                          />
                          {errors[`admin_${index}_name`] && <p className="text-xs font-semibold text-red-500">{errors[`admin_${index}_name`]}</p>}
                        </label>
                        <label className="space-y-2">
                          <span className="text-sm font-bold uppercase tracking-widest text-slate-400">Login Email</span>
                          <input
                            type="email"
                            value={admin.email}
                            onChange={(e) => updateAdmin(index, 'email', e.target.value)}
                            placeholder="admin@school.edu"
                            className={`w-full rounded-2xl border bg-slate-50 px-5 py-4 font-semibold text-slate-700 placeholder:text-slate-400 outline-none transition-all focus:border-blue-500 ${errors[`admin_${index}_email`] ? 'border-red-400' : 'border-slate-200'}`}
                          />
                          {errors[`admin_${index}_email`] && <p className="text-xs font-semibold text-red-500">{errors[`admin_${index}_email`]}</p>}
                        </label>
                        <label className="space-y-2">
                          <span className="text-sm font-bold uppercase tracking-widest text-slate-400">Secure Password</span>
                          <input
                            type="password"
                            value={admin.password}
                            onChange={(e) => updateAdmin(index, 'password', e.target.value)}
                            placeholder="Minimum 8 characters"
                            className={`w-full rounded-2xl border bg-slate-50 px-5 py-4 font-semibold text-slate-700 placeholder:text-slate-400 outline-none transition-all focus:border-blue-500 ${errors[`admin_${index}_password`] ? 'border-red-400' : 'border-slate-200'}`}
                          />
                          {errors[`admin_${index}_password`] && <p className="text-xs font-semibold text-red-500">{errors[`admin_${index}_password`]}</p>}
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50 px-5 py-4">
                <p className="text-sm font-semibold leading-6 text-slate-600">
                  By submitting this form, your institution requests onboarding review by the MySchools super-admin team. If approved, the school can be provisioned directly from this request without re-entering the details.
                </p>
              </div>

              {successMessage && (
                <div className={`rounded-2xl px-5 py-4 text-sm font-semibold ${successMessage.startsWith('Request #') ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-red-200 bg-red-50 text-red-700'}`}>
                  {successMessage}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-2xl bg-blue-600 py-4 text-lg font-black text-white transition-all hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {submitting ? 'Submitting Demo Request...' : 'Submit Demo Request'}
              </button>
            </form>
          </div>
        </section>

        <Footer theme="light" showCta={false} />
      </div>
    </>
  );
};

export default SchoolRegistration;
