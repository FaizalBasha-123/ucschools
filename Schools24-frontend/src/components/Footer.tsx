"use client"

import Link from "next/link"
import { Github, Mail, Globe } from "lucide-react"

export function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="border-t border-slate-200 bg-slate-50 mt-12">
      <div className="max-w-6xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* About */}
          <div>
            <h3 className="font-semibold text-slate-900 mb-4">MySchools</h3>
            <p className="text-sm text-slate-600">
              A modern, comprehensive school management platform for administrators, teachers, and students.
            </p>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold text-slate-900 mb-4">Legal</h4>
            <ul className="space-y-2">
              <li>
                <Link href="/privacy-policy" className="text-sm text-slate-600 hover:text-blue-600 underline">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/cookie-policy" className="text-sm text-slate-600 hover:text-blue-600 underline">
                  Cookie Policy
                </Link>
              </li>
              <li>
                <Link href="/terms-of-service" className="text-sm text-slate-600 hover:text-blue-600 underline">
                  Terms of Service
                </Link>
              </li>
            </ul>
          </div>

          {/* Support */}
          <div>
            <h4 className="font-semibold text-slate-900 mb-4">Support</h4>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>
                <a href="mailto:support@myschools.in" className="hover:text-blue-600 flex items-center gap-2">
                  <Mail size={16} />
                  Support
                </a>
              </li>
              <li>
                <a href="mailto:privacy@myschools.in" className="hover:text-blue-600 flex items-center gap-2">
                  <Mail size={16} />
                  Privacy Inquiry
                </a>
              </li>
            </ul>
          </div>

          {/* Links */}
          <div>
            <h4 className="font-semibold text-slate-900 mb-4">Connect</h4>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>
                <a href="https://myschools.in" className="hover:text-blue-600 flex items-center gap-2">
                  <Globe size={16} />
                  Website
                </a>
              </li>
              <li>
                <a href="https://github.com/myschools" className="hover:text-blue-600 flex items-center gap-2">
                  <Github size={16} />
                  GitHub
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Section */}
        <div className="border-t border-slate-200 pt-6">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-sm text-slate-600">
              © {currentYear} MySchools Educational Platform. All rights reserved.
            </p>
            <p className="text-sm text-slate-600">
              Made in 🇮🇳 | DPDPA 2023 Compliant
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}
