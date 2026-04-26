import { motion } from 'motion/react';
import { ArrowUp, Sparkles } from 'lucide-react';

export function FinalCTA() {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <section className="w-full py-24 md:py-32 px-4 flex flex-col items-center justify-center text-center relative overflow-hidden bg-neutral-900 dark:bg-neutral-950 mt-16">
      {/* Background glow matrix */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-1/2 left-1/2 -tranneutral-x-1/2 -tranneutral-y-1/2 w-full max-w-3xl h-64 bg-primary/20 blur-[100px] rounded-full pointer-events-none" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="relative z-10 max-w-2xl px-4"
      >
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-bold uppercase tracking-widest mb-6">
          <Sparkles className="size-3.5" />
          Stop Reading. Start Learning.
        </div>
        
        <h2 className="text-4xl md:text-5xl font-black text-white mb-6 tracking-tight">
          Your personalized curriculum is waiting.
        </h2>
        
        <p className="text-lg text-neutral-400 mb-10 leading-relaxed font-medium">
          Type ANY topic into the generator above. In less than ten seconds, you will enter a fully interactive, logically mapped classroom guided by an AI tutor dedicated solely to you.
        </p>

        <button 
          onClick={scrollToTop}
          className="group inline-flex items-center gap-3 bg-primary text-primary-foreground px-8 py-4 rounded-full font-bold text-lg transition-all hover:bg-primary/90 hover:scale-105 shadow-xl shadow-primary/20"
        >
          Generate a Classroom
          <ArrowUp className="size-5 group-hover:-tranneutral-y-1 transition-transform" />
        </button>
      </motion.div>
    </section>
  );
}
