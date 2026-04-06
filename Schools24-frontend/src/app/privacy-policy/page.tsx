import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export default function PrivacyPolicyPage() {
  const lastUpdated = "March 18, 2026"

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-12 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="space-y-4 border-b pb-8">
          <h1 className="text-4xl font-bold text-slate-900">Privacy Policy</h1>
          <p className="text-base text-slate-600">
            Schools24 is committed to protecting your privacy and ensuring you have a positive experience on our platform.
          </p>
          <p className="text-sm text-slate-500">Last updated: {lastUpdated}</p>
        </div>

        {/* Quick Links */}
        <div className="flex flex-wrap gap-2">
          <a href="#your-information" className="text-sm font-medium text-blue-600 hover:text-blue-700 underline">
            Your Information
          </a>
          <span className="text-slate-400">•</span>
          <a href="#data-protection" className="text-sm font-medium text-blue-600 hover:text-blue-700 underline">
            Data Protection
          </a>
          <span className="text-slate-400">•</span>
          <a href="#cookies" className="text-sm font-medium text-blue-600 hover:text-blue-700 underline">
            Cookies
          </a>
          <span className="text-slate-400">•</span>
          <a href="#minor-protection" className="text-sm font-medium text-blue-600 hover:text-blue-700 underline">
            Minor Protection
          </a>
          <span className="text-slate-400">•</span>
          <a href="#your-rights" className="text-sm font-medium text-blue-600 hover:text-blue-700 underline">
            Your Rights
          </a>
        </div>

        {/* Content */}
        <div className="space-y-8">
          {/* 1. Information We Collect */}
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">1. What Information We Collect</CardTitle>
              <CardDescription>We collect information you provide directly and automatically through use</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold text-slate-900 mb-2">Information You Provide</h4>
                <ul className="space-y-2 text-slate-700 list-disc list-inside">
                  <li><strong>Account Registration:</strong> Name, email, phone, password, school affiliation, role (student/teacher/admin)</li>
                  <li><strong>Educational Data:</strong> Class/section assignment, subject enrollment, APAAR/ABC federated identity numbers</li>
                  <li><strong>Academic Records:</strong> Attendance, grades, quiz scores, homework submissions, learning materials</li>
                  <li><strong>Admission Data:</strong> Date of birth, guardian information, parental consent records, evidence references</li>
                  <li><strong>Communications:</strong> Messages, feedback, support requests sent through the platform</li>
                  <li><strong>Payment Information:</strong> Through third-party processors (e.g., Razorpay)—we do not store card details</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900 mb-2">Information Collected Automatically</h4>
                <ul className="space-y-2 text-slate-700 list-disc list-inside">
                  <li><strong>Session Data:</strong> Login tokens, API refresh tokens, session identifiers</li>
                  <li><strong>Device & Network:</strong> IP address, browser type, user agent, device type (captured for security audit trails only)</li>
                  <li><strong>Usage Data:</strong> Pages visited, features used, time spent, interaction events (for system optimization)</li>
                  <li><strong>Cookies:</strong> Essential authentication cookies only—see "Cookies Policy" for details</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* 2. How We Use Your Information */}
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">2. How We Use Your Information</CardTitle>
              <CardDescription>We process your data only for legitimate purposes with proper consent</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold text-slate-900 mb-2">Core Service Delivery (Essential)</h4>
                <ul className="space-y-1 text-slate-700 list-disc list-inside text-sm">
                  <li>Provide educational platform access and manage your account</li>
                  <li>Track attendance, grades, and learning progress</li>
                  <li>Enable communication between teachers, students, and staff</li>
                  <li>Process fee payments and maintain financial records</li>
                  <li>Support learning via homework, quizzes, and study materials</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900 mb-2">Compliance & Legal (Required)</h4>
                <ul className="space-y-1 text-slate-700 list-disc list-inside text-sm">
                  <li>Comply with DPDPA 2023 (Data Protection) regulations</li>
                  <li>Maintain audit trails and security logs</li>
                  <li>Enforce parental consent for students under 18</li>
                  <li>Enable learner data portability via APAAR/ABC federated IDs</li>
                  <li>Respond to legal requests from education authorities</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900 mb-2">System Improvement (With Consent)</h4>
                <ul className="space-y-1 text-slate-700 list-disc list-inside text-sm">
                  <li>Analyze usage patterns to improve platform usability</li>
                  <li>Debug technical issues and fix bugs</li>
                  <li>Optimize performance and server reliability</li>
                  <li><strong>Non-essential analytics and behavioral tracking are DISABLED by default for all users, especially minors</strong></li>
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* 3. Data Protection (DPDPA) */}
          <Card id="data-protection">
            <CardHeader>
              <CardTitle className="text-2xl">3. Data Protection & Security</CardTitle>
              <CardDescription>We comply with India's Data Protection law (DPDPA 2023)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold text-slate-900 mb-2">Legal Basis for Processing</h4>
                <p className="text-slate-700 mb-2">
                  We process your personal data under these lawful bases (DPDPA 2023):
                </p>
                <ul className="space-y-2 text-slate-700 list-disc list-inside text-sm">
                  <li><strong>Contract Fulfillment:</strong> To provide educational services you have enrolled for</li>
                  <li><strong>Legal Obligation:</strong> To comply with education regulations and DPDPA requirements</li>
                  <li><strong>Voluntary Consent:</strong> For optional features (analytics, advanced learning tools)—you can withdraw anytime</li>
                  <li><strong>Legitimate Interest:</strong> Security, fraud prevention, platform optimization (with your knowledge)</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900 mb-2">Data Retention</h4>
                <ul className="space-y-2 text-slate-700 list-disc list-inside text-sm">
                  <li><strong>Active Account Data:</strong> Retained while account is active and for 1 year after closure (for legal/financial audits)</li>
                  <li><strong>Learning Records:</strong> Retained for educational value (certificates, transcripts) as per your school's retention policy</li>
                  <li><strong>Parental Consent Records:</strong> Retained for minimum 7 years for regulatory compliance</li>
                  <li><strong>Audit Logs:</strong> Retained for 3 years for security and compliance purposes</li>
                  <li><strong>Automatic Account Deletion:</strong> Option available to delete your account (some data retained per legal requirement)</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900 mb-2">Security Measures</h4>
                <ul className="space-y-2 text-slate-700 list-disc list-inside text-sm">
                  <li><strong>Encryption in Transit:</strong> HTTPS/TLS 1.3 for all data transmission</li>
                  <li><strong>Encryption at Rest:</strong> Database encryption for sensitive fields</li>
                  <li><strong>HttpOnly Cookies:</strong> Authentication tokens cannot be accessed by scripts</li>
                  <li><strong>CSRF Protection:</strong> Anti-forgery tokens for all state-changing operations</li>
                  <li><strong>Access Control:</strong> Role-based access (student/teacher/admin/super-admin) with strict authorization checks</li>
                  <li><strong>Audit Logging:</strong> All data access and modifications logged with IP, timestamp, and user identity</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* 4. Cookies */}
          <Card id="cookies">
            <CardHeader>
              <CardTitle className="text-2xl">4. Cookies Policy</CardTitle>
              <CardDescription>We use only essential cookies—no tracking or behavioral profiling</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-900">
                <p className="font-semibold mb-1">Essential Cookies Always Active</p>
                <p>Schools24 uses only 3 essential cookies required for functionality. No tracking, analytics, or marketing cookies are set unless you explicitly opt in.</p>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900 mb-2">Essential Cookies (Always Active)</h4>
                <div className="space-y-3 bg-slate-50 p-4 rounded">
                  <div>
                    <p className="font-medium text-slate-900">School24_api_token</p>
                    <p className="text-sm text-slate-600">JWT access token for API authentication. HttpOnly. Expires in 1 hour.</p>
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">School24_api_refresh</p>
                    <p className="text-sm text-slate-600">JWT refresh token to extend session. HttpOnly. Expires in 7 days.</p>
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">School24_csrf</p>
                    <p className="text-sm text-slate-600">CSRF token for form protection. NOT HttpOnly (JavaScript reads for security). Session-based.</p>
                  </div>
                </div>
                <p className="text-sm text-slate-600 mt-2">
                  These cookies cannot be disabled—they are required for login, session management, and form security.
                </p>
              </div>

              <div>
                <p className="text-sm text-slate-600">
                  <strong>No Non-Essential Cookies:</strong> Schools24 does not set analytics cookies (Google Analytics, Mixpanel, etc.), marketing cookies, or tracking pixels at this time.
                </p>
              </div>

              <div>
                <p className="text-sm text-slate-600">
                  See our <Link href="/cookie-policy" className="text-blue-600 hover:underline">full Cookie Policy</Link> for technical details.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* 5. Protection of Minors */}
          <Card id="minor-protection">
            <CardHeader>
              <CardTitle className="text-2xl">5. Special Protection for Minors (Under 18)</CardTitle>
              <CardDescription>Parental consent and data safeguards for students under 18</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold text-slate-900 mb-2">Parental Consent Requirement</h4>
                <p className="text-slate-700 mb-2">
                  For all students under 18 years of age, Schools24 requires explicit parental or guardian consent before:
                </p>
                <ul className="space-y-1 text-slate-700 list-disc list-inside text-sm">
                  <li>Admission to the school</li>
                  <li>Processing educational and personal data</li>
                  <li>Storing biometric or identification data (APAAR/ABC federated IDs)</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900 mb-2">Consent Verification</h4>
                <ul className="space-y-2 text-slate-700 list-disc list-inside text-sm">
                  <li><strong>Methods:</strong> Guardian consent can be provided via OTP, written declaration, digital signature, or in-person verification</li>
                  <li><strong>Record Keeping:</strong> All consent records include IP address, timestamp, consent method, and policy version for audit</li>
                  <li><strong>Withdrawal:</strong> Guardians can request withdrawal of consent at any time; we will cease processing immediately (except where legally required)</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900 mb-2">Banned Practices for Minors</h4>
                <ul className="space-y-1 text-slate-700 list-disc list-inside text-sm">
                  <li>✗ No behavioral tracking, profiling, or usage analytics without explicit guardian consent</li>
                  <li>✗ No targeted advertising or marketing communications</li>
                  <li>✗ No sale or sharing of minor data with third parties (except school staff and authorized education platforms)</li>
                  <li>✗ No dark patterns or manipulative design to encourage data sharing</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900 mb-2">Data Portability</h4>
                <p className="text-slate-700 text-sm">
                  Students under 18 have the right to data portability. Their educational records (learning progress, attendance, assessments) can be exported and transferred to another school via APAAR/ABC federated identity standards.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* 6. Federated Identity (APAAR/ABC) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">6. Federated Identity & Data Portability</CardTitle>
              <CardDescription>Support for APAAR/ABC and learner portability across schools</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold text-slate-900 mb-2">APAAR & ABC Standards</h4>
                <p className="text-slate-700 mb-2">
                  Schools24 supports India's national learner registry standards:
                </p>
                <ul className="space-y-2 text-slate-700 list-disc list-inside text-sm">
                  <li><strong>APAAR:</strong> Automated Permanent Academic Account Registry—unique learner ID across Indian schools</li>
                  <li><strong>ABC:</strong> Aadhaar Basic Card—secondary identifier for students with Aadhaar enrollment</li>
                  <li><strong>UDISE+:</strong> School code validation to support government education data systems</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900 mb-2">How We Use Federated IDs</h4>
                <ul className="space-y-1 text-slate-700 list-disc list-inside text-sm">
                  <li>Link student enrollment across multiple schools (for transfers)</li>
                  <li>Enable data portability when students change schools</li>
                  <li>Prevent duplicate learner records in government registries</li>
                  <li>Support learner transfer requests and reconciliation workflows</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900 mb-2">Your Rights</h4>
                <ul className="space-y-1 text-slate-700 list-disc list-inside text-sm">
                  <li>Request a transfer of your learning records to another school</li>
                  <li>Request correction of federated ID information</li>
                  <li>Obtain a data portability export in standard formats</li>
                  <li>Request removal from Schools24 while retaining portability to other schools</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* 7. Your Rights */}
          <Card id="your-rights">
            <CardHeader>
              <CardTitle className="text-2xl">7. Your DPDPA Rights</CardTitle>
              <CardDescription>Rights granted under Data Protection Act, 2023</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-slate-700">
                Under DPDPA 2023, you have the following rights:
              </p>
              <div className="space-y-3 bg-slate-50 p-4 rounded">
                <div>
                  <p className="font-semibold text-slate-900">Right to Know</p>
                  <p className="text-sm text-slate-600">Request what personal data we hold and how it is being used</p>
                </div>
                <div>
                  <p className="font-semibold text-slate-900">Right to Correct</p>
                  <p className="text-sm text-slate-600">Request correction of inaccurate or incomplete information</p>
                </div>
                <div>
                  <p className="font-semibold text-slate-900">Right to Erasure</p>
                  <p className="text-sm text-slate-600">Request deletion of your data (some data retained for legal/financial compliance)</p>
                </div>
                <div>
                  <p className="font-semibold text-slate-900">Right to Data Portability</p>
                  <p className="text-sm text-slate-600">Export your data in structured, machine-readable format</p>
                </div>
                <div>
                  <p className="font-semibold text-slate-900">Right to Withdraw Consent</p>
                  <p className="text-sm text-slate-600">Withdraw optional consents at any time (does not affect past processing)</p>
                </div>
                <div>
                  <p className="font-semibold text-slate-900">Right to Grievance</p>
                  <p className="text-sm text-slate-600">File a complaint with the Data Protection Board of India if your rights are violated</p>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900 mb-2">How to Exercise Your Rights</h4>
                <p className="text-slate-700 text-sm mb-3">
                  To exercise any of these rights, contact our Data Protection Officer:
                </p>
                <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
                  <p><strong>Email:</strong> privacy@schools24.in</p>
                  <p><strong>Response Time:</strong> 30 days (extendable if complex)</p>
                  <p className="text-xs text-slate-600 mt-2">Please include "DPDPA Request" in the subject line and clearly state which right you are exercising.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 8. Third-Party Sharing */}
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">8. Third-Party Data Sharing</CardTitle>
              <CardDescription>When and how we share your information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold text-slate-900 mb-2">We Share Data With</h4>
                <ul className="space-y-2 text-slate-700 list-disc list-inside text-sm">
                  <li><strong>School Staff:</strong> Teachers, admins, and staff within your school (use only for educational purposes)</li>
                  <li><strong>Government Education Systems:</strong> Ministry of Education connectors such as DIKSHA or DigiLocker, but only when those official integrations are configured and you opt in where required</li>
                  <li><strong>Payment Processors:</strong> Razorpay for fee transactions (PCI-DSS compliant; we store only transaction reference, not card data)</li>
                  <li><strong>Hosting Providers:</strong> Cloud services for data storage and application hosting (with data processing agreements)</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900 mb-2">We Do NOT Share With</h4>
                <ul className="space-y-1 text-slate-700 list-disc list-inside text-sm">
                  <li>✗ Marketing or advertising platforms</li>
                  <li>✗ Data brokers or information sellers</li>
                  <li>✗ Social media companies (unless you authorize via API)</li>
                  <li>✗ International entities (data is localized in India)</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900 mb-2">Data Processing Agreements</h4>
                <p className="text-slate-700 text-sm">
                  All third-party service providers have signed Data Processing Agreements (DPA) compliant with DPDPA 2023. These agreements limit use of data to specified purposes only.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* 9. Contact & Updates */}
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">9. Contact & Policy Updates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold text-slate-900 mb-2">Questions About This Policy?</h4>
                <div className="bg-slate-50 border border-slate-200 rounded p-3 text-sm">
                  <p><strong>Data Protection Officer:</strong></p>
                  <p>Email: <a href="mailto:privacy@schools24.in" className="text-blue-600 hover:underline">privacy@schools24.in</a></p>
                  <p>We will respond within 30 days of receipt.</p>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900 mb-2">Policy Updates</h4>
                <p className="text-slate-700 text-sm">
                  We may update this Privacy Policy to reflect changes in law, technology, or our practices. Material changes will be communicated via email (with 30 days' notice). Continued use after updates constitutes acceptance.
                </p>
                <p className="text-slate-600 text-sm mt-2">
                  Last updated: {lastUpdated}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Footer Links */}
        <div className="border-t pt-8 flex flex-col sm:flex-row gap-4 justify-center sm:justify-between items-center">
          <div className="flex gap-6 text-sm">
            <Link href="/terms-of-service" className="text-blue-600 hover:text-blue-700 hover:underline">
              Terms of Service
            </Link>
            <Link href="/cookie-policy" className="text-blue-600 hover:text-blue-700 hover:underline">
              Cookie Policy
            </Link>
          </div>
          <Link href="/">
            <Button variant="outline">Back to Home</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
