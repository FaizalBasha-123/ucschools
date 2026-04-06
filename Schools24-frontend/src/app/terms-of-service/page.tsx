import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-12 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="space-y-4 border-b pb-8">
          <h1 className="text-4xl font-bold text-slate-900">Terms of Service</h1>
          <p className="text-base text-slate-600">
            Agreement between you and Schools24 for using our platform.
          </p>
          <p className="text-sm text-slate-500">Last updated: March 18, 2026 | Effective from: March 18, 2026</p>
        </div>

        {/* Quick Summary */}
        <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded">
          <h3 className="font-semibold text-blue-900 mb-2">You Agree To:</h3>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li>Use Schools24 only for legitimate educational purposes</li>
            <li>Be responsible for your account security and activity</li>
            <li>Respect other users' privacy and intellectual property</li>
            <li>Comply with applicable laws and school policies</li>
            <li>Indemnify Schools24 for misuse of the platform</li>
          </ul>
        </div>

        {/* 1. Acceptance of Terms */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">1. Acceptance of Terms</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-slate-700">
              By accessing and using Schools24, you agree to be bound by these Terms of Service. If you do not agree with any part of these terms, you may not use the platform.
            </p>
            <p className="text-slate-700">
              These Terms constitute the entire agreement between you and Schools24 Educational Platform Pvt. Ltd. ("Schools24," "we," "us," "our") regarding your use of the platform.
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
              <p className="text-blue-900">
                <strong>Jurisdiction:</strong> These Terms are governed by the laws of India and subject to the jurisdiction of courts in India. DPDPA 2023 compliance is mandatory for all data processing.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 2. Definitions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">2. Definitions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm text-slate-700">
              <div>
                <p className="font-semibold text-slate-900">Account</p>
                <p>Your user profile, including login credentials, educational data, and personal information.</p>
              </div>
              <div>
                <p className="font-semibold text-slate-900">Content</p>
                <p>Any material posted, uploaded, or transmitted on Schools24 (homework, quizzes, messages, study materials, etc.).</p>
              </div>
              <div>
                <p className="font-semibold text-slate-900">User</p>
                <p>Any person accessing Schools24, including students, teachers, staff, admins, and parents/guardians.</p>
              </div>
              <div>
                <p className="font-semibold text-slate-900">School</p>
                <p>The educational institution using Schools24, represented by authorized administrators.</p>
              </div>
              <div>
                <p className="font-semibold text-slate-900">Intellectual Property (IP)</p>
                <p>Copyrights, trademarks, trade secrets, and patents—including Schools24's platform code and branding.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 3. User Eligibility */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">3. Who Can Use Schools24?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-semibold text-slate-900 mb-2">Eligibility Requirements</h4>
              <p className="text-slate-700 mb-3">
                You may use Schools24 only if:
              </p>
              <ul className="text-slate-700 space-y-2 list-disc list-inside">
                <li>You are authorized by your school to access the platform</li>
                <li>If you are under 18, a parent/guardian has provided consent (via the admission process)</li>
                <li>You use the platform only for its intended educational purpose</li>
                <li>You comply with all applicable laws and school policies</li>
              </ul>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
              <p className="text-sm text-yellow-900">
                <strong>Minors:</strong> If you are under 18, your parent/guardian must have accepted these Terms on your behalf during admission. Schools24 will not process your data without parental consent.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 4. Account Responsibility */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">4. Your Account & Security</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-semibold text-slate-900 mb-2">You Are Responsible For:</h4>
              <ul className="text-slate-700 space-y-1 list-disc list-inside text-sm">
                <li>Keeping your password confidential and secure</li>
                <li>All activity that occurs under your account (even if unauthorized)</li>
                <li>Notifying Schools24 immediately if you suspect unauthorized access</li>
                <li>Logging out after each session, especially on shared devices</li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-slate-900 mb-2">Account Suspension & Termination</h4>
              <p className="text-slate-700 text-sm mb-2">
                Schools24 may suspend or terminate your account if you:
              </p>
              <ul className="text-slate-700 space-y-1 list-disc list-inside text-sm">
                <li>Violate these Terms or applicable laws</li>
                <li>Harass, threaten, or abuse other users</li>
                <li>Post or upload inappropriate, illegal, or offensive content</li>
                <li>Attempt to access unauthorized areas or breach security</li>
                <li>Misrepresent your identity or credentials</li>
              </ul>
              <p className="text-slate-700 text-sm mt-2">
                We will provide notice before termination, except in cases of serious violation or legal requirement.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 5. Acceptable Use */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">5. Acceptable Use Policy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-slate-700">
              When using Schools24, you agree NOT to:
            </p>
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <div className="border rounded p-4 bg-red-50">
                <h4 className="font-semibold text-red-900 mb-2">Prohibited Activities</h4>
                <ul className="text-sm text-red-800 space-y-1 list-disc list-inside">
                  <li>Post obscene, defamatory, or libelous content</li>
                  <li>Harass, bully, or threaten other users</li>
                  <li>Impersonate another person</li>
                  <li>Attempt to hack or breach security</li>
                  <li>Upload malware, viruses, or dangerous files</li>
                  <li>Spam or post unsolicited advertisements</li>
                  <li>Infringe copyright or IP rights</li>
                  <li>Violate school policies or rules</li>
                </ul>
              </div>

              <div className="border rounded p-4 bg-orange-50">
                <h4 className="font-semibold text-orange-900 mb-2">Specific Prohibitions</h4>
                <ul className="text-sm text-orange-800 space-y-1 list-disc list-inside">
                  <li>Cheating on quizzes or assessments</li>
                  <li>Accessing another student's account</li>
                  <li>Recording sessions without consent</li>
                  <li>Selling or sharing academic work</li>
                  <li>Accessing from restricted countries</li>
                  <li>Using automated tools or bots</li>
                  <li>Creating duplicate accounts</li>
                  <li>Circumventing access controls</li>
                </ul>
              </div>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded p-4 mt-4">
              <p className="text-sm text-yellow-900">
                <strong>Enforcement:</strong> We monitor for violations using automated tools and manual review. Violations may result in account suspension, data deletion, or referral to law enforcement.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 6. Content Ownership & License */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">6. Content & Intellectual Property</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-semibold text-slate-900 mb-2">Your Content</h4>
              <p className="text-slate-700 text-sm mb-2">
                You retain ownership of any content you create (assignments, messages, etc.). However, by posting on Schools24, you grant:
              </p>
              <ul className="text-slate-700 space-y-1 list-disc list-inside text-sm">
                <li>Your school unlimited right to use your content for educational purposes</li>
                <li>Schools24 the right to store, backup, and process your content as needed</li>
                <li>Teachers the right to view, evaluate, and provide feedback</li>
              </ul>
              <p className="text-slate-700 text-sm mt-2">
                You may NOT republish or share others' content without consent.
              </p>
            </div>

            <div>
              <h4 className="font-semibold text-slate-900 mb-2">Schools24's Content</h4>
              <p className="text-slate-700 text-sm">
                The Schools24 platform, including design, code, features, study materials, and branding, is owned by Schools24 or our partners. You may NOT:
              </p>
              <ul className="text-slate-700 space-y-1 list-disc list-inside text-sm mt-2">
                <li>Copy or reverse-engineer our code</li>
                <li>Scrape or extract data from our servers</li>
                <li>Sell or redistribute Schools24 features</li>
                <li>Create derivative works without permission</li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-slate-900 mb-2">Teacher & Admin Content</h4>
              <p className="text-slate-700 text-sm">
                Content created by teachers and admins (lesson plans, quizzes, study materials) is typically owned by the school. Sharing with external parties requires permissions.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 7. Data Protection & Privacy */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">7. Data Protection & Your Privacy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-slate-700">
              Your personal data is protected under DPDPA 2023 (Data Protection Act). Please see our <Link href="/privacy-policy" className="text-blue-600 hover:underline">Privacy Policy</Link> for complete details.
            </p>

            <div className="bg-blue-50 border border-blue-200 rounded p-4">
              <h4 className="font-semibold text-blue-900 mb-2">Key Privacy Commitments</h4>
              <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                <li>We process only data necessary for educational purposes</li>
                <li>We do NOT sell your data to third parties</li>
                <li>We do NOT use behavioral tracking for minors</li>
                <li>We provide encryption, secure backups, and audit logs</li>
                <li>You have rights to access, correct, and delete your data</li>
                <li>Parental rights over children's data are fully respected</li>
              </ul>
            </div>

            <p className="text-slate-700 text-sm">
              For DPDPA complaints, contact our Data Protection Officer at <a href="mailto:privacy@schools24.in" className="text-blue-600 hover:underline">privacy@schools24.in</a> or file with the Data Protection Board of India.
            </p>
          </CardContent>
        </Card>

        {/* 8. Limitation of Liability */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">8. Limitation of Liability & Disclaimers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded p-4">
              <h4 className="font-semibold text-red-900 mb-2">AS-IS Disclaimer</h4>
              <p className="text-sm text-red-800">
                Schools24 is provided "AS-IS" without warranties. We do not guarantee:
              </p>
              <ul className="text-sm text-red-800 space-y-1 list-disc list-inside mt-2">
                <li>Uninterrupted access (we may have scheduled maintenance)</li>
                <li>Zero errors or bugs (we work to minimize them)</li>
                <li>Data recovery if you delete content</li>
                <li>That the platform will not be discontinued</li>
              </ul>
            </div>

            <div className="bg-red-50 border border-red-200 rounded p-4">
              <h4 className="font-semibold text-red-900 mb-2">Limitation on Damages</h4>
              <p className="text-sm text-red-800 mb-2">
                <strong>Schools24 shall NOT be liable for:</strong>
              </p>
              <ul className="text-sm text-red-800 space-y-1 list-disc list-inside">
                <li>Lost grades, assignments, or academic records</li>
                <li>Lost time due to platform downtime</li>
                <li>Third-party services (Razorpay, messaging, etc.)</li>
                <li>Indirect, incidental, or consequential damages</li>
                <li>Even if advised of such damages</li>
              </ul>
              <p className="text-sm text-red-800 mt-2">
                <strong>Maximum Liability:</strong> Schools24's total liability is limited to the amount you paid for the platform in the past 12 months.
              </p>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
              <p className="text-sm text-yellow-900">
                <strong>User Responsibilities:</strong> You are responsible for backing up important data and understanding that internet services may experience outages beyond our control.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 9. Indemnification */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">9. Indemnification</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-slate-700">
              You agree to defend and indemnify Schools24, including our officers, directors, employees, and agents, from:
            </p>
            <ul className="text-slate-700 space-y-1 list-disc list-inside text-sm mt-2">
              <li>Claims or damages arising from your use of Schools24</li>
              <li>Violation of these Terms or applicable laws</li>
              <li>Infringement of third-party intellectual property rights</li>
              <li>Content you post that harms others</li>
              <li>Your breach of parental/guardian responsibilities (for minors)</li>
            </ul>
            <p className="text-slate-700 text-sm mt-4">
              We will notify you promptly of any claims and give you control of the defense. You must not settle without our consent.
            </p>
          </CardContent>
        </Card>

        {/* 10. Third-Party Services */}
        <Card>
          <CardHeader>
            <CardTitle>10. Third-Party Services & External Links</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-slate-700">
              Schools24 may integrate with third-party services such as:
            </p>
            <ul className="text-slate-700 space-y-1 list-disc list-inside text-sm mt-2">
              <li><strong>Razorpay:</strong> Payment processing (fees, transactions)</li>
              <li><strong>DIKSHA/DigiLocker:</strong> Optional official government connectors, available only when the required onboarding and consent controls are in place</li>
              <li><strong>Cloud Storage:</strong> PostgreSQL, Cloudflare R2, Kubernetes hosting</li>
            </ul>

            <div className="bg-blue-50 border border-blue-200 rounded p-4">
              <h4 className="font-semibold text-blue-900 mb-2">Your Responsibility</h4>
              <p className="text-sm text-blue-800">
                Schools24 is not responsible for these third-party services' terms, privacy policies, or security. We have Data Processing Agreements (DPAs) with all partners to ensure DPDPA compliance, but you should review their terms separately.
              </p>
            </div>

            <p className="text-slate-700 text-sm">
              External links to third-party websites are provided for convenience. Schools24 does not endorse and is not liable for their content.
            </p>
          </CardContent>
        </Card>

        {/* 11. Modifications to Terms */}
        <Card>
          <CardHeader>
            <CardTitle>11. Changes to These Terms</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-slate-700">
              Schools24 may update these Terms at any time. Material changes will be notified to you via email with 30 days' notice. Continued use after changes constitutes acceptance.
            </p>
            <p className="text-slate-700 text-sm">
              We will maintain a version history at the top of this page showing the last effective date.
            </p>
          </CardContent>
        </Card>

        {/* 12. Termination */}
        <Card>
          <CardHeader>
            <CardTitle>12. Termination</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-semibold text-slate-900 mb-2">You Can Terminate</h4>
              <p className="text-slate-700 text-sm">
                You may request account deletion anytime by emailing <a href="mailto:support@schools24.in" className="text-blue-600 hover:underline">support@schools24.in</a>. We will delete your account within 30 days (except data required for audits/compliance).
              </p>
            </div>

            <div>
              <h4 className="font-semibold text-slate-900 mb-2">Schools24 Can Terminate</h4>
              <p className="text-slate-700 text-sm">
                Schools24 may terminate or suspend your account immediately if you violate these Terms or laws. We will attempt to notify you unless the violation is severe.
              </p>
            </div>

            <div>
              <h4 className="font-semibold text-slate-900 mb-2">Upon Termination</h4>
              <ul className="text-slate-700 space-y-1 list-disc list-inside text-sm">
                <li>Your account access ceases immediately</li>
                <li>Some data may be retained for audit/legal purposes (see Privacy Policy)</li>
                <li>Provisions on liability and IP remain in effect</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* 13. Contact & Support */}
        <Card>
          <CardHeader>
            <CardTitle>13. Contact Us</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-slate-700">
              For questions about these Terms or disputes:
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded p-4 space-y-2 text-sm">
              <p>
                <strong>Support Team:</strong><br />
                <a href="mailto:support@schools24.in" className="text-blue-600 hover:underline">support@schools24.in</a>
              </p>
              <p>
                <strong>Data Protection Officer (Privacy Issues):</strong><br />
                <a href="mailto:privacy@schools24.in" className="text-blue-600 hover:underline">privacy@schools24.in</a>
              </p>
              <p>
                <strong>Legal (Formal Notices):</strong><br />
                <a href="mailto:legal@schools24.in" className="text-blue-600 hover:underline">legal@schools24.in</a>
              </p>
              <p className="text-slate-600">
                Response time: 7-15 business days
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="border-t pt-8 flex flex-col sm:flex-row gap-4 justify-center sm:justify-between items-center">
          <div className="flex gap-6 text-sm">
            <Link href="/privacy-policy" className="text-blue-600 hover:text-blue-700 hover:underline">
              Privacy Policy
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
