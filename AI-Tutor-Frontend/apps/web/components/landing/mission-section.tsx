import { motion } from 'motion/react';
import { Sparkles, Brain, Infinity } from 'lucide-react';

export function MissionSection() {
  return (
    <section className="w-full max-w-6xl mx-auto py-24 md:py-32 px-4 md:px-8 border-t border-border/40 mt-16">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="space-y-6 flex flex-col"
        >
          <span className="text-emerald-600 dark:text-emerald-400 font-bold tracking-widest uppercase text-xs">Our Mission</span>
          <h2 className="text-3xl md:text-5xl font-black text-neutral-900 dark:text-white leading-[1.1] tracking-tight">
            We don&apos;t teach facts. <br/>
            <span className="text-muted-foreground">We construct realities.</span>
          </h2>
          <p className="text-lg text-neutral-600 dark:text-neutral-400 leading-relaxed font-medium">
            The traditional classroom forces a single mind to teach thirty unique variations of learners at one speed. AI-Tutor was built to shatter this barrier. 
          </p>
          <p className="text-neutral-500 dark:text-neutral-500 leading-relaxed">
            We believe that every conceptual roadblock is just a failure of context. By analyzing your unique constraints, our engine generates deeply personalized pedagogical environments—shifting analogies, rewriting pacing, and answering infinite questions with eternal patience until the concept finally clicks.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 relative">
          {/* Decorative glow */}
          <div className="absolute top-1/2 left-1/2 -tranneutral-x-1/2 -tranneutral-y-1/2 w-64 h-64 bg-emerald-500/10 dark:bg-emerald-500/20 blur-3xl rounded-full pointer-events-none" />

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="p-6 rounded-3xl bg-white/60 dark:bg-neutral-900/60 backdrop-blur-sm border border-neutral-200/50 dark:border-border/50 shadow-sm relative z-10"
          >
            <div className="size-12 rounded-2xl bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center mb-6">
              <Brain className="size-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h3 className="text-xl font-bold mb-3 text-neutral-900 dark:text-white">Semantic Memory</h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
              We remember how you learn. Visual thinker? We prioritize diagrams. Abstract thinker? We build philosophical analogies.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="p-6 rounded-3xl bg-white/60 dark:bg-neutral-900/60 backdrop-blur-sm border border-neutral-200/50 dark:border-border/50 shadow-sm relative z-10 sm:tranneutral-y-8"
          >
            <div className="size-12 rounded-2xl bg-amber-100 dark:bg-amber-500/10 flex items-center justify-center mb-6">
              <Infinity className="size-6 text-amber-600 dark:text-amber-400" />
            </div>
            <h3 className="text-xl font-bold mb-3 text-neutral-900 dark:text-white">Infinite Patience</h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
              Ask 100 times. Ask at 3 AM. A human gets tired. Your dedicated tutor matrix will relentlessly restructure the lesson until you grasp it.
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
