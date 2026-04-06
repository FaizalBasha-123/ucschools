import React from 'react';
import { Link } from 'react-router-dom';

type FooterProps = {
  theme?: 'light' | 'dark';
  showCta?: boolean;
};

const Footer: React.FC<FooterProps> = ({ theme = 'light', showCta = true }) => {
  const isDark = theme === 'dark';

  return (
    <footer className={isDark ? 'bg-black border-t border-white/10 text-white' : 'bg-white border-t border-slate-200 text-slate-900'}>
      {/* Top CTA Section */}
      {showCta ? (
        <div className={isDark ? 'border-b border-white/10 bg-[#050505]' : 'border-b border-slate-100 bg-slate-50'}>
          <div className="max-w-7xl mx-auto px-6 py-12 md:py-16 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-6">
            <div>
              <h3 className={isDark ? 'text-2xl font-bold text-white tracking-tight' : 'text-2xl font-bold text-slate-900 tracking-tight'}>Ready to transform your school?</h3>
              <p className={isDark ? 'mt-2 text-slate-300 font-medium' : 'mt-2 text-slate-600 font-medium'}>Join the thousands of institutions powering their future with MySchools.</p>
            </div>
            <div className="flex gap-4">
              <Link to="/register" className="rounded-full bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 transition-all">
                Get Started Free
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {/* Main Footer Content */}
      <div className="max-w-7xl mx-auto px-6 pt-16 pb-8 lg:px-8">
        <div className="xl:grid xl:grid-cols-3 xl:gap-8 mb-16">
          {/* Brand Column */}
          <div className="space-y-8 xl:col-span-1">
            <img src="/Logo.png" alt="MySchools" className="h-24 object-contain mb-2" />
            <p className={isDark ? 'max-w-md text-slate-300 leading-relaxed font-medium' : 'max-w-md text-slate-600 leading-relaxed font-medium'}>
              India's most trusted school admission and management network. Built for the next billion students.
            </p>
            <p className={isDark ? 'max-w-md mt-4 text-slate-300 leading-relaxed font-medium' : 'max-w-md mt-4 text-slate-600 leading-relaxed font-medium'}>Powering schools, Empowering students</p>
            <div className="flex space-x-5">
              <a href="https://linkedin.myschools.in" target="_blank" rel="noopener noreferrer" className={isDark ? 'text-slate-500 hover:text-blue-400 transition-colors' : 'text-slate-400 hover:text-blue-600 transition-colors'}>
                <span className="sr-only">LinkedIn</span>
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path fillRule="evenodd" d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" clipRule="evenodd" />
                </svg>
              </a>
              <a href="https://x.myschools.in" target="_blank" rel="noopener noreferrer" className={isDark ? 'text-slate-500 hover:text-white transition-colors' : 'text-slate-400 hover:text-slate-900 transition-colors'}>
                <span className="sr-only">X (Twitter)</span>
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a href="https://instagram.myschools.in" target="_blank" rel="noopener noreferrer" className={isDark ? 'text-slate-500 hover:text-pink-400 transition-colors' : 'text-slate-400 hover:text-pink-600 transition-colors'}>
                <span className="sr-only">Instagram</span>
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path fillRule="evenodd" d="M12.315 2c2.43 0 2.784.013 3.808.06 1.064.049 1.791.218 2.427.465a4.902 4.902 0 011.772 1.153 4.902 4.902 0 011.153 1.772c.247.636.416 1.363.465 2.427.048 1.067.06 1.407.06 4.123v.08c0 2.643-.012 2.987-.06 4.043-.049 1.064-.218 1.791-.465 2.427a4.902 4.902 0 01-1.153 1.772 4.902 4.902 0 01-1.772 1.153c-.636.247-1.363.416-2.427.465-1.067.048-1.407.06-4.123.06h-.08c-2.643 0-2.987-.012-4.043-.06-1.064-.049-1.791-.218-2.427-.465a4.902 4.902 0 01-1.153-1.772A4.902 4.902 0 015.45 2.525c.636-.247 1.363-.416 2.427-.465C8.901 2.013 9.256 2 11.685 2h.63zm-.081 1.802h-.468c-2.456 0-2.784.011-3.807.058-.975.045-1.504.207-1.857.344-.467.182-.8.398-1.15.748-.35.35-.566.683-.748 1.15-.137.353-.3.882-.344 1.857-.047 1.023-.058 1.351-.058 3.807v.468c0 2.456.011 2.784.058 3.807.045.975.207 1.504.344 1.857.182.466.399.8.748 1.15.35.35.683.566 1.15.748.353.137.882.3 1.857.344 1.054.048 1.37.058 4.041.058h.08c2.597 0 2.917-.01 3.96-.058.976-.045 1.505-.207 1.858-.344.466-.182.8-.398 1.15-.748.35-.35.566-.683.748-1.15.137-.353.3-.882.344-1.857.048-1.055.058-1.37.058-4.041v-.08c0-2.597-.01-2.917-.058-3.96-.045-.976-.207-1.505-.344-1.858a3.097 3.097 0 00-.748-1.15 3.098 3.098 0 00-1.15-.748c-.353-.137-.882-.3-1.857-.344-1.023-.047-1.351-.058-3.807-.058zM12 6.865a5.135 5.135 0 110 10.27 5.135 5.135 0 010-10.27zm0 1.802a3.333 3.333 0 100 6.666 3.333 3.333 0 000-6.666zm5.338-3.205a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z" clipRule="evenodd" />
                </svg>
              </a>
              <a href="https://facebook.myschools.in" target="_blank" rel="noopener noreferrer" className={isDark ? 'text-slate-500 hover:text-blue-400 transition-colors' : 'text-slate-400 hover:text-blue-800 transition-colors'}>
                <span className="sr-only">Facebook</span>
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path fillRule="evenodd" d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" clipRule="evenodd" />
                </svg>
              </a>
            </div>
          </div>

          {/* Links Grid */}
            <div className="mt-16 grid grid-cols-2 gap-8 xl:col-span-2 xl:mt-0">
            <div className="md:grid md:grid-cols-1 md:gap-8">
              <div>
                <h3 className={isDark ? 'text-sm font-semibold leading-6 text-white tracking-wide uppercase' : 'text-sm font-semibold leading-6 text-slate-900 tracking-wide uppercase'}>Support</h3>
                <ul role="list" className="mt-6 space-y-4">
                  <li><Link to="/help-center" className={isDark ? 'text-sm leading-6 text-slate-300 hover:text-blue-400 font-medium transition-colors' : 'text-sm leading-6 text-slate-600 hover:text-blue-600 font-medium transition-colors'}>Help Center</Link></li>
                </ul>
              </div>
            </div>
            <div className="md:grid md:grid-cols-2 md:gap-8">
              <div>
                <h3 className={isDark ? 'text-sm font-semibold leading-6 text-white tracking-wide uppercase' : 'text-sm font-semibold leading-6 text-slate-900 tracking-wide uppercase'}>Company</h3>
                <ul role="list" className="mt-6 space-y-4">
                  <li><Link to="/about" className={isDark ? 'text-sm leading-6 text-slate-300 hover:text-blue-400 font-medium transition-colors' : 'text-sm leading-6 text-slate-600 hover:text-blue-600 font-medium transition-colors'}>About Us</Link></li>
                  <li><Link to="/blogs" className={isDark ? 'text-sm leading-6 text-slate-300 hover:text-blue-400 font-medium transition-colors' : 'text-sm leading-6 text-slate-600 hover:text-blue-600 font-medium transition-colors'}>Blogs</Link></li>
                  <li><Link to="/contact" className={isDark ? 'text-sm leading-6 text-slate-300 hover:text-blue-400 font-medium transition-colors' : 'text-sm leading-6 text-slate-600 hover:text-blue-600 font-medium transition-colors'}>Contact</Link></li>
                </ul>
              </div>
              <div className="mt-10 md:mt-0">
                <h3 className={isDark ? 'text-sm font-semibold leading-6 text-white tracking-wide uppercase' : 'text-sm font-semibold leading-6 text-slate-900 tracking-wide uppercase'}>Legal</h3>
                <ul role="list" className="mt-6 space-y-4">
                  <li><Link to="/privacy-policy" className={isDark ? 'text-sm leading-6 text-slate-300 hover:text-blue-400 font-medium transition-colors' : 'text-sm leading-6 text-slate-600 hover:text-blue-600 font-medium transition-colors'}>Privacy Policy</Link></li>
                  <li><Link to="/terms-of-service" className={isDark ? 'text-sm leading-6 text-slate-300 hover:text-blue-400 font-medium transition-colors' : 'text-sm leading-6 text-slate-600 hover:text-blue-600 font-medium transition-colors'}>Terms</Link></li>
                  <li><Link to="/refund-policy" className={isDark ? 'text-sm leading-6 text-slate-300 hover:text-blue-400 font-medium transition-colors' : 'text-sm leading-6 text-slate-600 hover:text-blue-600 font-medium transition-colors'}>Refund Policy</Link></li>
                  <li><Link to="/child-safety" className={isDark ? 'text-sm leading-6 text-slate-300 hover:text-blue-400 font-medium transition-colors' : 'text-sm leading-6 text-slate-600 hover:text-blue-600 font-medium transition-colors'}>Child Safety</Link></li>
                  <li><Link to="/contact" className={isDark ? 'text-sm leading-6 text-slate-300 hover:text-blue-400 font-medium transition-colors' : 'text-sm leading-6 text-slate-600 hover:text-blue-600 font-medium transition-colors'}>Contact</Link></li>
                  <li><Link to="/security" className={isDark ? 'text-sm leading-6 text-slate-300 hover:text-blue-400 font-medium transition-colors' : 'text-sm leading-6 text-slate-600 hover:text-blue-600 font-medium transition-colors'}>Security</Link></li>
                  <li><Link to="/compliance" className={isDark ? 'text-sm leading-6 text-slate-300 hover:text-blue-400 font-medium transition-colors' : 'text-sm leading-6 text-slate-600 hover:text-blue-600 font-medium transition-colors'}>Compliance</Link></li>
                  <li><Link to="/intellectual-property" className={isDark ? 'text-sm leading-6 text-slate-300 hover:text-blue-400 font-medium transition-colors' : 'text-sm leading-6 text-slate-600 hover:text-blue-600 font-medium transition-colors'}>Copyright Policy</Link></li>
                  <li><Link to="/service-level-agreement" className={isDark ? 'text-sm leading-6 text-slate-300 hover:text-blue-400 font-medium transition-colors' : 'text-sm leading-6 text-slate-600 hover:text-blue-600 font-medium transition-colors'}>SLA</Link></li>
                  <li><Link to="/disclaimer" className={isDark ? 'text-sm leading-6 text-slate-300 hover:text-blue-400 font-medium transition-colors' : 'text-sm leading-6 text-slate-600 hover:text-blue-600 font-medium transition-colors'}>Disclaimer</Link></li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className={isDark ? 'mt-16 border-t border-white/10 pt-8 sm:mt-20 lg:mt-24 flex flex-col md:flex-row items-center justify-between gap-6' : 'mt-16 border-t border-slate-200/80 pt-8 sm:mt-20 lg:mt-24 flex flex-col md:flex-row items-center justify-between gap-6'}>
          <p className={isDark ? 'text-xs leading-5 text-slate-400 font-medium text-center md:text-left' : 'text-xs leading-5 text-slate-500 font-medium text-center md:text-left'}>
            &copy; {new Date().getFullYear()} <a href="https://bluevolt.group/" target="_blank" rel="noopener noreferrer" className={isDark ? 'underline decoration-slate-500 underline-offset-2 hover:text-blue-300' : 'underline decoration-slate-400 underline-offset-2 hover:text-blue-700'}>BlueVolt Groups Private Limited</a>. All rights reserved. Registered in Bangalore, India.
          </p>
          <p className={isDark ? 'text-xs leading-5 text-slate-500 font-medium text-center md:text-right' : 'text-xs leading-5 text-slate-400 font-medium text-center md:text-right'}>
            Powering schools, Empowering students
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
