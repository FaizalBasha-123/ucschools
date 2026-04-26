import { motion } from 'motion/react';
import { BookOpen, Presentation, FileText } from 'lucide-react';

export function UseCasesSection() {
  return (
    <section className="w-full max-w-6xl mx-auto py-24 md:py-32 px-4 md:px-8 border-t border-border/40">
      <div className="text-center mb-20">
        <span className="text-primary font-bold tracking-widest uppercase text-xs">Why People Let Us Guide Them</span>
        <h2 className="text-3xl md:text-5xl font-black text-neutral-900 dark:text-white mt-4 tracking-tight">
          Adaptable for every mind.
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Use Case 1 */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="group rounded-3xl border border-neutral-200/60 dark:border-border/60 bg-white/50 dark:bg-neutral-900/50 backdrop-blur-xl shadow-sm hover:shadow-lg transition-all p-8 flex flex-col"
        >
          <div className="size-14 rounded-2xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-3 transition-transform">
            <BookOpen className="size-7 text-blue-600 dark:text-blue-400" />
          </div>
          <h3 className="text-2xl font-bold mb-4 text-neutral-900 dark:text-white">The Student</h3>
          <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed font-medium mb-6">
            "11 PM cramming made safe."
          </p>
          <p className="text-sm text-neutral-500 dark:text-neutral-500 leading-relaxed mt-auto">
            Stuck on a tricky calculus concept? Generate an instant interactive classroom that acts as a Socratic tutor, questioning rather than telling, ensuring you actually understand the core principles before the exam.
          </p>
        </motion.div>

        {/* Use Case 2 */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="group rounded-3xl border-2 border-primary/20 bg-white dark:bg-neutral-900/80 backdrop-blur-xl shadow-md hover:shadow-xl transition-all p-8 flex flex-col relative sm:-tranneutral-y-4"
        >
          <div className="absolute top-0 left-1/2 -tranneutral-x-1/2 h-1 w-20 bg-primary rounded-b-full shadow-[0_0_10px_rgba(30,215,96,0.5)]" />
          <div className="size-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
            <Presentation className="size-7 text-primary" />
          </div>
          <h3 className="text-2xl font-bold mb-4 text-neutral-900 dark:text-white">The Educator</h3>
          <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed font-medium mb-6">
            "Draft a 12-slide interactive lesson in 4 seconds."
          </p>
          <p className="text-sm text-neutral-500 dark:text-neutral-500 leading-relaxed mt-auto">
            Instead of spending hours gathering images and formatting layouts, input your syllabus topic. Our engine instantly builds a comprehensive, beautiful slide deck complete with interactive voice agents ready for your class.
          </p>
        </motion.div>

        {/* Use Case 3 */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="group rounded-3xl border border-neutral-200/60 dark:border-border/60 bg-white/50 dark:bg-neutral-900/50 backdrop-blur-xl shadow-sm hover:shadow-lg transition-all p-8 flex flex-col"
        >
          <div className="size-14 rounded-2xl bg-purple-50 dark:bg-purple-500/10 flex items-center justify-center mb-6 group-hover:scale-110 -group-hover:rotate-3 transition-transform">
            <FileText className="size-7 text-purple-600 dark:text-purple-400" />
          </div>
          <h3 className="text-2xl font-bold mb-4 text-neutral-900 dark:text-white">The Polymath</h3>
          <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed font-medium mb-6">
            "Distill 500-page density."
          </p>
          <p className="text-sm text-neutral-500 dark:text-neutral-500 leading-relaxed mt-auto">
            Upload dense research PDFs. The AI pipeline reads the raw academic text and completely restructures it into digestible, sequential modules—allowing you to ingest high-level knowledge at extreme velocities.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
