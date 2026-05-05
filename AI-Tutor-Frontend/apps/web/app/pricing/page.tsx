'use client';

import { Suspense, useEffect, useState, useMemo } from 'react';
import {
  Check,
  Loader2,
  X,
  Zap,
  Mic2,
  FileText,
  BookOpen,
  HelpCircle,
  ArrowRight,
  Sparkles,
  Play,
  Layers,
  ChevronDown,
  Globe,
  Ticket,
  School
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { SiteHeader } from '@/components/layout/site-header';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { hasAuthSessionHint } from '@/lib/auth/session';

// ─── Constants & Types ───────────────────────────────────────

interface BillingProduct {
  product_code: string;
  kind: 'subscription' | 'bundle';
  title: string;
  description: string;
  credits: number;
  currency: string;
  amount_minor: number;
  gst_amount_minor: number;
  is_highlighted: boolean;
  features: string[];
  pdf_limit: number;
  modes: string[];
}

const FAQ_ITEMS = [
  {
    q: "How do credits work?",
    a: "Credits are the currency of AI Tutor. Every action (generating a slide, using voice, or running a simulation) consumes a small amount of credits based on the AI model quality you choose."
  },
  {
    q: "Can I upgrade or downgrade anytime?",
    a: "Yes! You can change your plan at any time. When you upgrade, your new credits are added immediately. Downgrades take effect at the end of your current billing cycle."
  },
  {
    q: "What happens if I run out of credits?",
    a: "If you hit zero credits, you can either wait for your monthly renewal or purchase a one-time &apos;Power Up&apos; bundle to keep learning without changing your plan."
  },
  {
    q: "Do unused credits roll over?",
    a: "Subscription credits do not roll over; they reset each month. However, any &apos;Power Up&apos; bundle credits you purchase separately never expire."
  }
];

const MODES_DISPLAY = [
  { id: 'revision', label: 'Revision', icon: Zap, desc: 'Quick summaries & memory cues', color: 'orange' },
  { id: 'explain', label: 'Explain', icon: BookOpen, desc: 'Deep structured teaching', color: 'blue' },
  { id: 'exam', label: 'Exam', icon: FileText, desc: 'MCQ & practice questions', color: 'orange' },
  { id: 'placement', label: 'Placement', icon: Globe, desc: 'Interview & aptitude prep', color: 'blue' },
];

// ─── Components ──────────────────────────────────────────────

const CALC_QUALITY = [
  { id: 'basic', label: 'Basic', rate: 0.4, color: 'emerald' },
  { id: 'standard', label: 'Standard', rate: 0.8, color: 'blue' },
  { id: 'premium', label: 'Premium', rate: 1.5, color: 'amber' },
];

const CALC_LEARNING = [
  { id: 'explain', label: 'Explain', mul: 1.6 },
  { id: 'revision', label: 'Revision', mul: 0.6 },
  { id: 'exam', label: 'Exam', mul: 1.3 },
  { id: 'placement', label: 'Placement', mul: 2.0 },
];

function CreditBreakdownCalculator() {
  const [quality, setQuality] = useState(CALC_QUALITY[1]);
  const [learning, setLearning] = useState(CALC_LEARNING[0]);
  const [duration, setDuration] = useState(5); // minutes
  const [useVoice, setUseVoice] = useState(true);
  const [usePdf, setUsePdf] = useState(false);
  const [pdfPages, setPdfPages] = useState(10);

  // Generation always costs a base of 4 credits (core slide + structure build)
  const baseCost = 4.0;
  const modeCost = +(quality.rate * learning.mul * duration).toFixed(2);
  const voiceCost = useVoice ? +(quality.rate * duration * 0.5).toFixed(2) : 0;
  const pdfCost = usePdf ? +(pdfPages * 0.15).toFixed(2) : 0;
  const totalCost = +(baseCost + modeCost + voiceCost + pdfCost).toFixed(2);

  const lineItems = [
    { label: 'Lesson Generation', desc: 'Core slides & structure', cost: baseCost },
    { label: `${learning.label} Mode`, desc: `${duration} min × ${quality.label}`, cost: modeCost },
    ...(useVoice ? [{ label: 'Voice Interaction', desc: `${duration} min TTS + ASR`, cost: voiceCost }] : []),
    ...(usePdf ? [{ label: 'PDF Context', desc: `${pdfPages} pages processed`, cost: pdfCost }] : []),
  ];

  return (
    <div className="bg-neutral-900 text-white rounded-[3rem] p-10 md:p-16 overflow-hidden relative">
      <div className="absolute top-0 right-0 w-1/3 h-full bg-emerald-600/10 blur-[100px] rounded-full" />
      <div className="relative z-10 grid lg:grid-cols-2 gap-16 items-start">
        {/* Left: Controls */}
        <div>
          <h2 className="text-3xl md:text-5xl font-black mb-4 tracking-tight">
            Credit Breakdown
            <br />
            <span className="text-emerald-600">Calculator</span>
          </h2>
          <p className="text-neutral-400 text-base mb-8 leading-relaxed">
            Adjust the options to estimate how many credits a session will cost.
          </p>

          {/* Quality */}
          <div className="mb-6">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
              AI Quality
            </label>
            <div className="grid grid-cols-3 gap-2">
              {CALC_QUALITY.map((q) => (
                <button
                  key={q.id}
                  onClick={() => setQuality(q)}
                  className={cn(
                    'rounded-xl border px-3 py-2 text-xs font-semibold text-center transition-all',
                    quality.id === q.id
                      ? 'bg-white/10 border-white/30 text-white ring-1 ring-white/20'
                      : 'border-white/10 text-neutral-500 hover:border-white/20 hover:text-white',
                  )}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          {/* Learning Style */}
          <div className="mb-6">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
              Learning Style
            </label>
            <div className="grid grid-cols-2 gap-2">
              {CALC_LEARNING.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLearning(l)}
                  className={cn(
                    'rounded-xl border px-3 py-2 text-xs font-semibold text-center transition-all',
                    learning.id === l.id
                      ? 'bg-white/10 border-white/30 text-white ring-1 ring-white/20'
                      : 'border-white/10 text-neutral-500 hover:border-white/20 hover:text-white',
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          {/* Duration */}
          <div className="mb-6">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
              Session Duration: <span className="text-white">{duration} min</span>
            </label>
            <input
              type="range"
              min={1}
              max={30}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-emerald-500"
            />
            <div className="flex justify-between text-[10px] text-neutral-600 mt-1">
              <span>1 min</span>
              <span>30 min</span>
            </div>
          </div>

          {/* Toggles */}
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={() => setUseVoice(!useVoice)}
              className={cn(
                'px-4 py-2 rounded-full text-xs font-semibold border transition-all',
                useVoice
                  ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400'
                  : 'bg-white/5 border-white/10 text-neutral-500 hover:text-white',
              )}
            >
              <Mic2 className="inline size-3.5 mr-1.5 -mt-0.5" />
              Voice {useVoice ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={() => setUsePdf(!usePdf)}
              className={cn(
                'px-4 py-2 rounded-full text-xs font-semibold border transition-all',
                usePdf
                  ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400'
                  : 'bg-white/5 border-white/10 text-neutral-500 hover:text-white',
              )}
            >
              <FileText className="inline size-3.5 mr-1.5 -mt-0.5" />
              PDF {usePdf ? 'ON' : 'OFF'}
            </button>
          </div>

          {usePdf && (
            <div className="mt-4">
              <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
                PDF Pages: <span className="text-white">{pdfPages}</span>
              </label>
              <input
                type="range"
                min={1}
                max={100}
                value={pdfPages}
                onChange={(e) => setPdfPages(Number(e.target.value))}
                className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-emerald-500"
              />
              <div className="flex justify-between text-[10px] text-neutral-600 mt-1">
                <span>1 page</span>
                <span>100 pages</span>
              </div>
            </div>
          )}
        </div>

        {/* Right: Live Breakdown */}
        <div className="bg-white/5 rounded-3xl p-8 border border-white/10 backdrop-blur-md">
          <div className="flex items-center gap-2 mb-6">
            <div className="size-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-bold text-neutral-400 uppercase tracking-widest">
              Live Estimate
            </span>
          </div>

          <div className="space-y-5">
            {lineItems.map((item, i) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex justify-between items-center group"
              >
                <div>
                  <p className="font-bold text-white group-hover:text-emerald-500 transition-colors">
                    {item.label}
                  </p>
                  <p className="text-xs text-neutral-500">{item.desc}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono font-bold text-emerald-500">
                    +{item.cost.toFixed(1)}
                  </p>
                  <p className="text-[10px] text-neutral-600 uppercase">credits</p>
                </div>
              </motion.div>
            ))}

            <div className="pt-6 border-t border-white/10 flex justify-between items-center">
              <p className="text-xl font-black uppercase tracking-tighter">
                Total Estimated
              </p>
              <div className="text-right">
                <motion.p
                  key={totalCost}
                  initial={{ scale: 1.15, color: '#10B981' }}
                  animate={{ scale: 1, color: '#ffffff' }}
                  className="text-3xl font-black"
                >
                  {totalCost.toFixed(1)}
                </motion.p>
                <p className="text-[10px] text-neutral-400 uppercase font-bold">
                  Credits / session
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PricingContent() {
  const router = useRouter();
  const isAuthenticated = hasAuthSessionHint();

  const [allProducts, setAllProducts] = useState<BillingProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [showComingSoon, setShowComingSoon] = useState(false);

  // Promo code state
  const [promoCode, setPromoCode] = useState('');
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [redeemStatus, setRedeemStatus] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    async function fetchProducts() {
      try {
        const res = await fetch('/api/billing/catalog');
        if (!res.ok) throw new Error('Failed to fetch pricing');
        const json = await res.json();
        const items = json.items || [];

        // Enrich backend data with frontend-only display features
        const enriched: BillingProduct[] = items.map((p: any) => {
          let features: string[] = [];
          let pdf_limit = 0;
          let modes: string[] = [];
          const code = p.product_code.toLowerCase();

          if (code.includes('free')) {
            features = ['20 Credits included', 'Revision mode (Limited)', 'Explain mode access', 'Voice: Pay-per-use (in credits)', 'See credit system below'];
            pdf_limit = 0;
            modes = ['Revision'];
          } else if (code.includes('starter')) {
            features = ['180 Credits / month', 'Revision + Explain modes', 'Exam mode access', 'Placement mode (Limited)', 'PDF uploads: 5 files', 'Voice: Pay-per-use (in credits)', 'See credit system below'];
            pdf_limit = 5;
            modes = ['Revision', 'Explain'];
          } else if (code.includes('pro')) {
            features = ['650 Credits / month', 'All learning modes', 'PDF uploads: 25 files', 'Priority Support', 'Voice: Pay-per-use (in credits)', 'See credit system below'];
            pdf_limit = 25;
            modes = ['Revision', 'Explain', 'Exam', 'Placement (Ltd)'];
          } else if (code.includes('power')) {
            features = ['1800 Credits / month', 'Everything Unlocked', 'PDF uploads: 100 files', 'Early access to new features', 'Voice: Pay-per-use (in credits)', 'See credit system below'];
            pdf_limit = 100;
            modes = ['All Modes'];
          } else {
            // Fallback for other plans (like credit packs if they show up)
            features = [`${p.credits} Credits included`, 'No subscription required'];
          }

          return { ...p, features, pdf_limit, modes };
        });

        setAllProducts(enriched);
      } catch (err: any) {
        console.error('Pricing fetch error:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchProducts();
  }, []);

  const displayedProducts = useMemo(() => {
    // 1. Get all subscription products for the current cycle
    const subscriptions = allProducts.filter(p =>
      p.kind === 'subscription' &&
      (billingCycle === 'yearly' ? p.product_code.endsWith('_yearly') : !p.product_code.endsWith('_yearly'))
    );

    // 2. Get the free tier (usually doesn't have a yearly variant)
    const freeTier = allProducts.find(p => p.product_code.toLowerCase().includes('free'));

    // 3. Combine in a sensible order: Free -> Starter -> Pro -> Power
    const order = ['free', 'starter', 'pro', 'power'];
    const result: BillingProduct[] = [];

    order.forEach(base => {
      if (base === 'free' && freeTier) {
        result.push(freeTier);
      } else {
        const found = subscriptions.find(s => s.product_code.toLowerCase().includes(base));
        if (found) result.push(found);
      }
    });

    // 4. Add any other subscriptions not in the order list (fallback)
    subscriptions.forEach(s => {
      if (!result.find(r => r.product_code === s.product_code)) {
        result.push(s);
      }
    });

    return result;
  }, [allProducts, billingCycle]);

  const handleCheckout = async (productCode: string) => {
    setShowComingSoon(true);
  };

  const handleRedeemPromo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      router.push('/login?redirect=/pricing');
      return;
    }
    if (!promoCode.trim()) return;

    setRedeemLoading(true);
    setRedeemStatus(null);
    try {
      const res = await fetch('/api/credits/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: promoCode.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid promo code');

      setRedeemStatus({ success: true, message: data.message || 'Successfully redeemed!' });
      setPromoCode('');
    } catch (err: any) {
      setRedeemStatus({ success: false, message: err.message });
    } finally {
      setRedeemLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-neutral-950">
        <Loader2 className="size-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center bg-white dark:bg-neutral-950 p-4 text-center">
        <h2 className="text-2xl font-bold text-red-600 mb-4">Oops! Something went wrong</h2>
        <p className="text-neutral-600 dark:text-neutral-400 mb-8">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950 selection:bg-emerald-100 dark:selection:bg-emerald-900/30">
      <SiteHeader variant="pricing" />

      <AnimatePresence>
        {showComingSoon && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white dark:bg-neutral-900 p-10 rounded-[2.5rem] shadow-2xl max-w-lg w-full text-center relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-emerald-500 to-blue-500" />
              <div className="mb-6 flex justify-center">
                <div className="w-20 h-20 rounded-3xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600">
                  <Zap className="size-10" />
                </div>
              </div>
              <h2 className="text-3xl font-black mb-4 text-neutral-900 dark:text-white">Coming Soon!</h2>
              <p className="text-neutral-600 dark:text-neutral-400 mb-8 leading-relaxed">
                We are currently finalizing our secure payment integration with Stripe & Easebuzz to provide you with a seamless experience.
                <br /><br />
                Your interest has been noted! We'll notify you as soon as premium plans are live.
              </p>
              <button
                onClick={() => setShowComingSoon(false)}
                className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold text-lg hover:bg-emerald-700 transition-all"
              >
                Got it, thanks!
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="relative pt-20 pb-24 overflow-hidden">
        {/* ── Background Gradients ── */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[600px] pointer-events-none -z-10 overflow-hidden">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/5 blur-[120px] rounded-full" />
          <div className="absolute top-[20%] right-[-10%] w-[30%] h-[50%] bg-blue-500/5 blur-[120px] rounded-full" />
        </div>

        <div className="container px-4 mx-auto max-w-7xl">
          {/* ── Hero Section ── */}
          <div className="text-center max-w-3xl mx-auto mb-16">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-neutral-900 dark:text-white mb-6">
                Simple, transparent pricing for your <span className="text-emerald-600">AI Tutor</span>
              </h1>
              <p className="text-lg md:text-xl text-neutral-600 dark:text-neutral-400 leading-relaxed">
                Learn faster with voice, interactive lessons, and personalized guidance.
              </p>
            </motion.div>

            {/* ── Billing Toggle ── */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="mt-10 flex items-center justify-center gap-4"
            >
              <span className={cn("text-sm font-medium", billingCycle === 'monthly' ? "text-neutral-900 dark:text-white" : "text-neutral-500")}>Monthly</span>
              <button
                onClick={() => setBillingCycle(prev => prev === 'monthly' ? 'yearly' : 'monthly')}
                className="relative w-12 h-6 rounded-full bg-neutral-200 dark:bg-neutral-800 transition-colors"
              >
                <div className={cn(
                  "absolute top-1 left-1 w-4 h-4 rounded-full bg-emerald-600 transition-transform duration-200",
                  billingCycle === 'yearly' && "translate-x-6"
                )} />
              </button>
              <span className={cn("text-sm font-medium", billingCycle === 'yearly' ? "text-neutral-900 dark:text-white" : "text-neutral-500")}>
                Yearly <span className="text-emerald-600 text-xs ml-1 font-bold">(-20%)</span>
              </span>
            </motion.div>
          </div>

          {/* ── Pricing Grid ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-24">
            {displayedProducts.map((p, idx) => {
              const monthlyEquivalent = billingCycle === 'yearly' && p.amount_minor > 0
                ? Math.round(p.amount_minor / 1200)
                : Math.round(p.amount_minor / 100);

              return (
                <motion.div
                  key={p.product_code}
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 * idx, duration: 0.5 }}
                  className={cn(
                    "relative flex flex-col p-8 rounded-3xl border transition-all duration-300",
                    p.is_highlighted
                      ? "bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 border-neutral-900 dark:border-white shadow-2xl scale-105 z-10"
                      : "bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 hover:border-emerald-500/50"
                  )}
                >
                  {p.is_highlighted && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full whitespace-nowrap shadow-xl">
                      Most Popular
                    </div>
                  )}

                  <div className="mb-8">
                    <h3 className="text-lg font-bold mb-2 uppercase tracking-wide opacity-80">{p.title}</h3>
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-black">₹{monthlyEquivalent}</span>
                      <span className="text-sm opacity-60">/mo</span>
                    </div>
                    {billingCycle === 'yearly' && p.amount_minor > 0 && (
                      <div className="text-[10px] font-bold text-emerald-600 mt-1">
                        Billed ₹{Math.round(p.amount_minor / 100)}/year
                      </div>
                    )}
                    <p className="mt-4 text-sm leading-relaxed opacity-70 min-h-[40px]">
                      {p.description}
                    </p>
                  </div>

                  <div className="flex-1 space-y-4 mb-8">
                    {p.features.map((feat) => (
                      <div key={feat} className="flex items-start gap-3">
                        <div className={cn(
                          "mt-1 shrink-0 rounded-full p-0.5",
                          p.is_highlighted ? "bg-emerald-600" : "bg-emerald-100 dark:bg-emerald-900/30"
                        )}>
                          <Check className={cn("size-3", p.is_highlighted ? "text-white" : "text-emerald-600")} />
                        </div>
                        <span className="text-sm font-medium leading-tight">{feat}</span>
                      </div>
                    ))}

                    {p.product_code === 'free' && (
                      <div className="flex items-start gap-3 opacity-40">
                        <div className="mt-1 shrink-0 rounded-full p-0.5 bg-neutral-100">
                          <X className="size-3 text-neutral-400" />
                        </div>
                        <span className="text-sm font-medium leading-tight line-through">PDF Uploads</span>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => handleCheckout(p.product_code)}
                    disabled={!!checkoutLoading}
                    className={cn(
                      "w-full py-4 px-6 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 group",
                      p.is_highlighted
                        ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-600/20"
                        : "bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white hover:bg-emerald-600 hover:text-white"
                    )}
                  >
                    {checkoutLoading === p.product_code ? (
                      <Loader2 className="size-5 animate-spin" />
                    ) : (
                      <>
                        {p.amount_minor === 0 ? "Get Started" : "Upgrade Now"}
                        <ArrowRight className="size-4 group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </button>
                </motion.div>
              );
            })}
          </div>

          {/* ── Promo & Enterprise Section ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-24 max-w-5xl mx-auto">
            {/* Promo Code */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="p-8 rounded-[2.5rem] bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-sm"
            >
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 mb-6">
                <Ticket className="size-6" />
              </div>
              <h3 className="text-xl font-bold mb-2">Have a promo code?</h3>
              <p className="text-sm text-neutral-500 mb-6">Enter your code below to redeem instant credits.</p>

              <form onSubmit={handleRedeemPromo} className="flex gap-2">
                <input
                  type="text"
                  placeholder="PROMO2026"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  className="flex-1 px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all uppercase font-mono tracking-widest text-sm"
                />
                <button
                  type="submit"
                  disabled={redeemLoading || !promoCode.trim()}
                  className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all disabled:opacity-50 flex items-center gap-2 text-sm shadow-lg shadow-emerald-600/20"
                >
                  {redeemLoading ? <Loader2 className="size-4 animate-spin" /> : "Redeem"}
                </button>
              </form>

              {redeemStatus && (
                <motion.p
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "mt-4 text-xs font-bold",
                    redeemStatus.success ? "text-green-600" : "text-red-600"
                  )}
                >
                  {redeemStatus.message}
                </motion.p>
              )}
            </motion.div>

            {/* Enterprise / Sales */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="p-8 rounded-[2.5rem] bg-[#0F172A] text-white overflow-hidden relative group"
            >
              <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
                <School size={160} />
              </div>
              <div className="relative z-10">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-white/10 text-white mb-6">
                  <Globe className="size-6" />
                </div>
                <h3 className="text-xl font-bold mb-2">Enterprise & Institutions</h3>
                <p className="text-sm text-white/60 mb-8 max-w-xs">
                  Schools, academies, and universities. Get bulk credits, central management, and white-glove support.
                </p>
                <button
                  onClick={() => router.push('/enterprise')}
                  className="px-8 py-3 bg-white text-[#0F172A] rounded-xl font-bold hover:bg-neutral-200 transition-all text-sm flex items-center gap-2 group/btn"
                >
                  Contact Sales <ArrowRight className="size-4 group-hover/btn:translate-x-1 transition-transform" />
                </button>
              </div>
            </motion.div>
          </div>

          {/* ── Section: Transparent Credit Usage ── */}
          <section className="mt-24 mb-12 p-8 md:p-16 bg-neutral-50 dark:bg-neutral-900/40 rounded-[3rem] border border-neutral-200 dark:border-neutral-800">
            <div className="text-center max-w-2xl mx-auto mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-4">Transparent Credit Usage</h2>
              <p className="text-neutral-600 dark:text-neutral-400">Understand how credits are used across lessons, voice, and PDFs.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* ── Lesson & Modes Matrix ── */}
              <div className="bg-white dark:bg-neutral-900 p-6 md:p-8 rounded-3xl shadow-sm border border-neutral-200 dark:border-neutral-800">
                <h3 className="text-xl font-bold mb-6 flex items-center gap-2">Lesson & Modes</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-neutral-100 dark:border-neutral-800">
                        <th className="py-4 font-semibold text-neutral-500">Feature</th>
                        <th className="py-4 font-semibold text-neutral-500">Basic</th>
                        <th className="py-4 font-bold text-emerald-600 bg-emerald-50/50 dark:bg-emerald-900/10 px-4">Standard</th>
                        <th className="py-4 font-semibold text-neutral-500">Premium</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800/50">
                      {[
                        { f: 'Lesson Generation', b: '2', s: '4', p: '8' },
                        { f: 'Revision Mode', b: '1.2', s: '2.4', p: '4.8' },
                        { f: 'Explain Mode', b: '3.2', s: '6.4', p: '12.8' },
                        { f: 'Exam Mode', b: '—', s: '5.2', p: '10.4' },
                        { f: 'Placement Mode', b: '—', s: '~8', p: '~16' },
                      ].map((row, i) => (
                        <tr key={i} className="group hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors">
                          <td className="py-4 pr-4 font-medium text-neutral-900 dark:text-neutral-100">{row.f}</td>
                          <td className="py-4 text-neutral-600 dark:text-neutral-400">{row.b}</td>
                          <td className="py-4 font-bold text-neutral-900 dark:text-white bg-emerald-50/50 dark:bg-emerald-900/10 px-4">{row.s}</td>
                          <td className="py-4 text-neutral-600 dark:text-neutral-400">{row.p}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-8">
                {/* ── Voice Usage Table ── */}
                <div className="bg-white dark:bg-neutral-900 p-6 md:p-8 rounded-3xl shadow-sm border border-neutral-200 dark:border-neutral-800">
                  <h3 className="text-xl font-bold mb-6 flex items-center gap-2">Voice Usage</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead>
                        <tr className="border-b border-neutral-100 dark:border-neutral-800">
                          <th className="py-4 font-semibold text-neutral-500">Feature</th>
                          <th className="py-4 font-semibold text-neutral-500">Basic</th>
                          <th className="py-4 font-semibold text-neutral-500">Standard</th>
                          <th className="py-4 font-semibold text-neutral-500">Premium</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800/50">
                        {[
                          { f: 'TTS (per minute)', b: '0.4', s: '0.8', p: '1.5' },
                          { f: 'ASR (per minute)', b: '0.5', s: '1', p: '1.5' },
                        ].map((row, i) => (
                          <tr key={i} className="group hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors">
                            <td className="py-4 font-medium text-neutral-900 dark:text-neutral-100">{row.f}</td>
                            <td className="py-4 text-neutral-600 dark:text-neutral-400">{row.b}</td>
                            <td className="py-4 text-neutral-600 dark:text-neutral-400">{row.s}</td>
                            <td className="py-4 text-neutral-600 dark:text-neutral-400">{row.p}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ── PDF Usage Table ── */}
                <div className="bg-white dark:bg-neutral-900 p-6 md:p-8 rounded-3xl shadow-sm border border-neutral-200 dark:border-neutral-800">
                  <h3 className="text-xl font-bold mb-6">PDF Processing</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead>
                        <tr className="border-b border-neutral-100 dark:border-neutral-800">
                          <th className="py-4 font-semibold text-neutral-500">Plan</th>
                          <th className="py-4 font-semibold text-neutral-500">Cost per page</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800/50">
                        {[
                          { p: 'Starter', c: '0.20 credits' },
                          { p: 'Pro', c: '0.15 credits' },
                          { p: 'Power', c: '0.12 credits' },
                        ].map((row, i) => (
                          <tr key={i} className="group hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors">
                            <td className="py-4 font-medium text-neutral-900 dark:text-neutral-100">{row.p}</td>
                            <td className="py-4 text-neutral-600 dark:text-neutral-400">{row.c}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-4 text-xs text-neutral-500 italic">
                    Example: A 50-page PDF typically uses 8–11 credits depending on your plan.
                  </p>
                </div>
              </div>
            </div>

            {/* ── Media & Footnote ── */}
            <div className="mt-8 flex flex-col md:flex-row items-center justify-between gap-6 p-6 bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg text-emerald-600">
                  <Sparkles className="size-5" />
                </div>
                <div>
                  <span className="text-sm font-bold block">Image Generation</span>
                  <span className="text-xs text-neutral-500">3–8 credits per image</span>
                </div>
              </div>
              <p className="text-[10px] md:text-xs text-neutral-400 max-w-md text-center md:text-right">
                Credit usage varies slightly based on content complexity and output size. Values shown are typical estimates.
              </p>
            </div>
          </section>

          {/* ── Section: Credit Breakdown Calculator ── */}
          <section className="mb-32">
            <CreditBreakdownCalculator />
          </section>

          {/* ── Section: FAQ ── */}
          <section className="max-w-3xl mx-auto mb-32">
            <h2 className="text-3xl font-bold mb-12 text-center text-neutral-900 dark:text-white flex items-center justify-center gap-3">
              <HelpCircle className="size-8 text-emerald-600" /> Frequently Asked Questions
            </h2>
            <div className="space-y-4">
              {FAQ_ITEMS.map((item, i) => (
                <div key={i} className="p-6 rounded-2xl bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-200 dark:border-neutral-800">
                  <h4 className="font-bold text-neutral-900 dark:text-white mb-2">{item.q}</h4>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">{item.a}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── Final CTA ── */}
          <section className="relative p-12 md:p-20 rounded-[3rem] bg-neutral-900 dark:bg-white text-center overflow-hidden">
            <div className="absolute inset-0 opacity-20 pointer-events-none">
              <div className="absolute top-[-50%] left-[-50%] w-[100%] h-[100%] bg-emerald-600 blur-[150px] rounded-full" />
              <div className="absolute bottom-[-50%] right-[-50%] w-[100%] h-[100%] bg-blue-600 blur-[150px] rounded-full" />
            </div>

            <div className="relative z-10">
              <h2 className="text-4xl md:text-5xl font-black text-white dark:text-neutral-900 mb-6 tracking-tight">
                Ready to transform your learning?
              </h2>
              <p className="text-xl text-neutral-400 dark:text-neutral-500 mb-10 max-w-2xl mx-auto">
                Join thousands of students and teachers using AI Tutor to learn smarter, not harder.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <button
                  onClick={() => router.push('/')}
                  className="px-10 py-5 bg-emerald-600 text-white rounded-2xl font-bold text-lg hover:bg-emerald-700 transition-all shadow-xl hover:shadow-emerald-600/20"
                >
                  Start for free today
                </button>
                <button className="px-10 py-5 bg-white/5 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-2xl font-bold text-lg hover:bg-white/10 dark:hover:bg-neutral-200 transition-all border border-white/10 dark:border-neutral-200">
                  Contact Sales
                </button>
              </div>
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}

export default function PricingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <PricingContent />
    </Suspense>
  );
}
