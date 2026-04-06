import React, { useMemo, useState } from 'react';
import SEOMeta from '../components/SEOMeta';
import StaticPageShell from '../components/StaticPageShell';

type Category = 'general' | 'technical' | 'billing' | 'academic' | 'other';
type Priority = 'low' | 'medium' | 'high' | 'critical';

const CATEGORY_OPTIONS: Array<{ value: Category; label: string }> = [
  { value: 'general', label: 'General' },
  { value: 'technical', label: 'Technical' },
  { value: 'billing', label: 'Billing' },
  { value: 'academic', label: 'Academic' },
  { value: 'other', label: 'Other' },
];

const PRIORITY_OPTIONS: Array<{ value: Priority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const HelpCenter: React.FC = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [organization, setOrganization] = useState('');
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<Category>('general');
  const [priority, setPriority] = useState<Priority>('medium');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successTicket, setSuccessTicket] = useState<number | null>(null);

  const endpoint = useMemo(() => {
    return '/api/public/support-tickets';
  }, []);

  const canSubmit =
    name.trim().length >= 2 &&
    /\S+@\S+\.\S+/.test(email.trim()) &&
    subject.trim().length >= 5 &&
    description.trim().length >= 10;

  const resetForm = () => {
    setName('');
    setEmail('');
    setOrganization('');
    setSubject('');
    setCategory('general');
    setPriority('medium');
    setDescription('');
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    setError(null);
    setSuccessTicket(null);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          organization: organization.trim(),
          subject: subject.trim(),
          category,
          priority,
          description: description.trim(),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || payload.message || 'Failed to submit support request.');
      }

      setSuccessTicket(payload.ticket?.ticket_number ?? null);
      resetForm();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to submit support request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
    <SEOMeta
      title="Help Center – MySchools Support"
      description="Submit a support ticket or browse solutions for MySchools platform issues. Your request reaches the central team for fast triage and response."
      path="/help-center"
    />
    <StaticPageShell
      eyebrow="Support"
      title={<>Help that reaches the <span className="text-blue-600">right team</span> fast.</>}
      description="Use the same structured support workflow that powers the MySchools platform. Your request goes to the central super-admin help center for triage and response."
    >
      <div className="md:col-span-2 grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 md:p-8 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
          <div className="mb-6">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-blue-600">Create Support Ticket</p>
            <h2 className="mt-3 text-2xl md:text-3xl font-black tracking-tight text-slate-900">Describe the issue clearly.</h2>
            <p className="mt-2 text-sm md:text-base font-medium text-slate-500">
              This form feeds directly into the MySchools support queue used by the platform team.
            </p>
          </div>

          {successTicket ? (
            <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-700">Submitted</p>
              <p className="mt-2 text-slate-900 font-semibold">
                Ticket #{successTicket} has been created. The support team can now see it in the super-admin help center.
              </p>
            </div>
          ) : null}

          {error ? (
            <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-700">
              {error}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slate-800">Name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-slate-900 outline-none transition focus:border-blue-500"
                  placeholder="Full name"
                  minLength={2}
                  required
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slate-800">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-slate-900 outline-none transition focus:border-blue-500"
                  placeholder="name@school.org"
                  required
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-800">Organization / School</span>
              <input
                type="text"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-slate-900 outline-none transition focus:border-blue-500"
                placeholder="Optional"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-800">Subject</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-slate-900 outline-none transition focus:border-blue-500"
                placeholder="Brief summary of your issue"
                minLength={5}
                required
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slate-800">Category</span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Category)}
                  className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-slate-900 outline-none transition focus:border-blue-500"
                >
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slate-800">Priority</span>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Priority)}
                  className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-slate-900 outline-none transition focus:border-blue-500"
                >
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-800">Description</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-[168px] w-full rounded-[1.5rem] border border-slate-200 px-4 py-3 text-slate-900 outline-none transition focus:border-blue-500"
                placeholder="Explain the issue clearly. Include the page, workflow, and what you expected to happen."
                minLength={10}
                required
              />
              <span className="mt-2 block text-xs font-semibold text-slate-400">
                {description.length} characters
              </span>
            </label>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-2">
              <button
                type="submit"
                disabled={!canSubmit || submitting}
                className="inline-flex h-12 items-center justify-center rounded-full bg-blue-600 px-6 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {submitting ? 'Submitting…' : 'Submit Ticket'}
              </button>
            </div>
          </form>
        </div>

        <div className="space-y-6">
          <div className="rounded-[2rem] border border-slate-200 bg-slate-50 p-6 md:p-8">
            <h3 className="text-xl font-black tracking-tight text-slate-900">What happens next</h3>
            <ul className="mt-4 space-y-3 text-sm md:text-base font-medium text-slate-600">
              <li>1. The request enters the same central support queue used inside the dashboard.</li>
              <li>2. Super-admin users see the unread notification immediately.</li>
              <li>3. The ticket can be triaged, updated, resolved, or deleted from the existing help-center workflow.</li>
            </ul>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-slate-50 p-6 md:p-8">
            <h3 className="text-xl font-black tracking-tight text-slate-900">Direct contact</h3>
            <p className="mt-4 text-sm md:text-base font-medium leading-7 text-slate-600">
              Email: partner@MySchools.in
              <br />
              Phone: +91 9110893850
            </p>
          </div>
        </div>
      </div>
    </StaticPageShell>
    </>
  );
};

export default HelpCenter;
