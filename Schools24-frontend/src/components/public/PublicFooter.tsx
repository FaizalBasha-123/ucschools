import Link from "next/link"

export function PublicFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white text-slate-900">
      <div className="border-b border-slate-100 bg-slate-50">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-6 py-12 md:flex-row md:py-16 lg:px-8">
          <div>
            <h3 className="text-2xl font-bold tracking-tight text-slate-900">Ready to transform your school?</h3>
            <p className="mt-2 font-medium text-slate-600">Join the thousands of institutions powering their future with Schools24.</p>
          </div>
          <div className="flex gap-4">
            <Link href="https://schools24.in/register" className="rounded-full bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
              Get Started Free
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 pb-8 pt-16 lg:px-8">
        <div className="mb-16 xl:grid xl:grid-cols-3 xl:gap-8">
          <div className="space-y-8 xl:col-span-1">
            <img src="/Logo.png" alt="Schools24" className="mb-2 h-24 object-contain" />
            <p className="max-w-md font-medium leading-relaxed text-slate-600">
              India&apos;s most trusted school admission and management network. Built for the next billion students.
            </p>
            <p className="mt-4 max-w-md font-medium leading-relaxed text-slate-600">Powering schools, Empowering students</p>
            <div className="flex space-x-5">
              <a href="https://linkedin.schools24.in" target="_blank" rel="noopener noreferrer" className="text-slate-400 transition-colors hover:text-blue-600">
                <span className="sr-only">LinkedIn</span>
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path fillRule="evenodd" d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" clipRule="evenodd" />
                </svg>
              </a>
              <a href="https://x.schools24.in" target="_blank" rel="noopener noreferrer" className="text-slate-400 transition-colors hover:text-slate-900">
                <span className="sr-only">X (Twitter)</span>
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a href="https://instagram.schools24.in" target="_blank" rel="noopener noreferrer" className="text-slate-400 transition-colors hover:text-pink-600">
                <span className="sr-only">Instagram</span>
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path fillRule="evenodd" d="M12.315 2c2.43 0 2.784.013 3.808.06 1.064.049 1.791.218 2.427.465a4.902 4.902 0 011.772 1.153 4.902 4.902 0 011.153 1.772c.247.636.416 1.363.465 2.427.048 1.067.06 1.407.06 4.123v.08c0 2.643-.012 2.987-.06 4.043-.049 1.064-.218 1.791-.465 2.427a4.902 4.902 0 01-1.153 1.772 4.902 4.902 0 01-1.772 1.153c-.636.247-1.363.416-2.427.465-1.067.048-1.407.06-4.123.06h-.08c-2.643 0-2.987-.012-4.043-.06-1.064-.049-1.791-.218-2.427-.465a4.902 4.902 0 01-1.153-1.772A4.902 4.902 0 015.45 2.525c.636-.247 1.363-.416 2.427-.465C8.901 2.013 9.256 2 11.685 2h.63zm-.081 1.802h-.468c-2.456 0-2.784.011-3.807.058-.975.045-1.504.207-1.857.344-.467.182-.8.398-1.15.748-.35.35-.566.683-.748 1.15-.137.353-.3.882-.344 1.857-.047 1.023-.058 1.351-.058 3.807v.468c0 2.456.011 2.784.058 3.807.045.975.207 1.504.344 1.857.182.466.399.8.748 1.15.35.35.683.566 1.15.748.353.137.882.3 1.857.344 1.054.048 1.37.058 4.041.058h.08c2.597 0 2.917-.01 3.96-.058.976-.045 1.505-.207 1.858-.344.466-.182.8-.398 1.15-.748.35-.35.566-.683.748-1.15.137-.353.3-.882.344-1.857.048-1.055.058-1.37.058-4.041v-.08c0-2.597-.01-2.917-.058-3.96-.045-.976-.207-1.505-.344-1.858a3.097 3.097 0 00-.748-1.15 3.098 3.098 0 00-1.15-.748c-.353-.137-.882-.3-1.857-.344-1.023-.047-1.351-.058-3.807-.058zM12 6.865a5.135 5.135 0 110 10.27 5.135 5.135 0 010-10.27zm0 1.802a3.333 3.333 0 100 6.666 3.333 3.333 0 000-6.666zm5.338-3.205a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z" clipRule="evenodd" />
                </svg>
              </a>
              <a href="https://facebook.schools24.in" target="_blank" rel="noopener noreferrer" className="text-slate-400 transition-colors hover:text-blue-800">
                <span className="sr-only">Facebook</span>
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path fillRule="evenodd" d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" clipRule="evenodd" />
                </svg>
              </a>
            </div>
          </div>

          <div className="mt-16 grid grid-cols-2 gap-8 xl:col-span-2 xl:mt-0">
            <div className="md:grid md:grid-cols-1 md:gap-8">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-900">Support</h3>
                <ul className="mt-6 space-y-4 text-sm">
                  <li><Link href="https://schools24.in/help-center" className="font-medium text-slate-600 transition-colors hover:text-blue-600">Help Center</Link></li>
                </ul>
              </div>
            </div>
            <div className="md:grid md:grid-cols-2 md:gap-8">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-900">Company</h3>
                <ul className="mt-6 space-y-4 text-sm">
                  <li><Link href="https://schools24.in/about" className="font-medium text-slate-600 transition-colors hover:text-blue-600">About Us</Link></li>
                  <li><Link href="https://schools24.in/blogs" className="font-medium text-slate-600 transition-colors hover:text-blue-600">Blogs</Link></li>
                  <li><Link href="https://schools24.in/contact" className="font-medium text-slate-600 transition-colors hover:text-blue-600">Contact</Link></li>
                </ul>
              </div>
              <div className="mt-10 md:mt-0">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-900">Legal</h3>
                <ul className="mt-6 space-y-4 text-sm">
                  <li><Link href="https://schools24.in/privacy-policy" className="font-medium text-slate-600 transition-colors hover:text-blue-600">Privacy Policy</Link></li>
                  <li><Link href="https://schools24.in/terms-of-service" className="font-medium text-slate-600 transition-colors hover:text-blue-600">Terms</Link></li>
                  <li><Link href="https://schools24.in/refund-policy" className="font-medium text-slate-600 transition-colors hover:text-blue-600">Refund Policy</Link></li>
                  <li><Link href="https://schools24.in/child-safety" className="font-medium text-slate-600 transition-colors hover:text-blue-600">Child Safety</Link></li>
                  <li><Link href="https://schools24.in/contact" className="font-medium text-slate-600 transition-colors hover:text-blue-600">Contact</Link></li>
                  <li><Link href="https://schools24.in/security" className="font-medium text-slate-600 transition-colors hover:text-blue-600">Security</Link></li>
                  <li><Link href="https://schools24.in/compliance" className="font-medium text-slate-600 transition-colors hover:text-blue-600">Compliance</Link></li>
                  <li><Link href="https://schools24.in/intellectual-property" className="font-medium text-slate-600 transition-colors hover:text-blue-600">Copyright Policy</Link></li>
                  <li><Link href="https://schools24.in/service-level-agreement" className="font-medium text-slate-600 transition-colors hover:text-blue-600">SLA</Link></li>
                  <li><Link href="https://schools24.in/disclaimer" className="font-medium text-slate-600 transition-colors hover:text-blue-600">Disclaimer</Link></li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-16 flex flex-col items-center justify-between gap-6 border-t border-slate-200/80 pt-8 md:flex-row">
          <p className="text-center text-xs font-medium leading-5 text-slate-500 md:text-left">
            &copy; {new Date().getFullYear()}{" "}
            <a href="https://bluevolt.group/" target="_blank" rel="noopener noreferrer" className="underline decoration-slate-400 underline-offset-2 hover:text-blue-700">
              BlueVolt Groups Private Limited
            </a>
            . All rights reserved. Registered in Bangalore, India.
          </p>
          <p className="text-center text-xs font-medium leading-5 text-slate-400 md:text-right">
            Powering schools, Empowering students
          </p>
        </div>
      </div>
    </footer>
  )
}
