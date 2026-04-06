import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export default function CookiePolicyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-12 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="space-y-4 border-b pb-8">
          <h1 className="text-4xl font-bold text-slate-900">Cookie Policy</h1>
          <p className="text-base text-slate-600">
            Understand what cookies Schools24 uses and how to manage your preferences.
          </p>
          <p className="text-sm text-slate-500">Last updated: March 18, 2026</p>
        </div>

        {/* Quick Summary */}
        <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded">
          <h3 className="font-semibold text-blue-900 mb-2">Quick Summary</h3>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li><strong>Essential cookies only</strong> — No tracking or behavioral profiling</li>
            <li><strong>3 cookies total</strong> — All required for login and security</li>
            <li><strong>No non-essential cookies</strong> — Analytics and marketing cookies are not used</li>
            <li><strong>HttpOnly tokens</strong> — Secure by design, inaccessible to scripts</li>
            <li><strong>GDPR & DPDPA compliant</strong> — Meets data protection and privacy regulations</li>
          </ul>
        </div>

        {/* What is a Cookie */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">What is a Cookie?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-slate-700">
              A cookie is a small text file stored on your device (computer, phone, tablet) when you visit a website. Cookies help websites remember information about your visit, such as your login status or preferences.
            </p>
            <div className="bg-slate-50 p-4 rounded">
              <p className="text-sm text-slate-700">
                <strong>Example:</strong> When you log in to Schools24, a cookie is set on your device that says "this user is logged in." When you refresh the page, the website reads that cookie and knows you're still logged in—you don't have to log in again.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Cookies We Use */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Cookies We Use</CardTitle>
            <CardDescription>3 essential cookies required for functionality</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-green-50 border border-green-200 rounded p-4">
              <h4 className="font-semibold text-green-900 mb-3 flex items-center gap-2">
                <span className="text-lg">✓</span> Essential Cookies (Always Active)
              </h4>
              <p className="text-sm text-green-800 mb-4">
                These cookies are required for Schools24 to function. You cannot disable them, and they do not require your consent.
              </p>

              <div className="space-y-4">
                {/* Cookie 1 */}
                <div className="border border-green-100 rounded p-4 bg-white">
                  <div className="space-y-2">
                    <p className="font-mono font-semibold text-slate-900">School24_api_token</p>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="font-semibold text-slate-700">Purpose</p>
                        <p className="text-slate-600">API access token for authentication</p>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-700">Type</p>
                        <p className="text-slate-600">Session cookie</p>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-700">Expiry</p>
                        <p className="text-slate-600">1 hour after login</p>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-700">Security</p>
                        <p className="text-slate-600">HttpOnly (JavaScript cannot access)</p>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 border-t pt-2 mt-2">
                      <strong>What it does:</strong> Proves you are logged in to Schools24. Without this, you'd be logged out immediately after each page refresh.
                    </p>
                  </div>
                </div>

                {/* Cookie 2 */}
                <div className="border border-green-100 rounded p-4 bg-white">
                  <div className="space-y-2">
                    <p className="font-mono font-semibold text-slate-900">School24_api_refresh</p>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="font-semibold text-slate-700">Purpose</p>
                        <p className="text-slate-600">JWT refresh token for extended sessions</p>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-700">Type</p>
                        <p className="text-slate-600">Persistent cookie</p>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-700">Expiry</p>
                        <p className="text-slate-600">7 days</p>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-700">Security</p>
                        <p className="text-slate-600">HttpOnly</p>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 border-t pt-2 mt-2">
                      <strong>What it does:</strong> Keeps you logged in for up to 7 days. When your access token (above) expires, this cookie generates a new one automatically.
                    </p>
                  </div>
                </div>

                {/* Cookie 3 */}
                <div className="border border-green-100 rounded p-4 bg-white">
                  <div className="space-y-2">
                    <p className="font-mono font-semibold text-slate-900">School24_csrf</p>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="font-semibold text-slate-700">Purpose</p>
                        <p className="text-slate-600">CSRF security token</p>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-700">Type</p>
                        <p className="text-slate-600">Session cookie</p>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-700">Expiry</p>
                        <p className="text-slate-600">End of session (browser close)</p>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-700">Security</p>
                        <p className="text-slate-600">NOT HttpOnly (frontend reads it)</p>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 border-t pt-2 mt-2">
                      <strong>What it does:</strong> Protects you from forged requests. When you submit a form, Schools24 checks that this token is valid. This prevents attackers from impersonating you.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded p-4">
              <h4 className="font-semibold text-slate-900 mb-2">Non-Essential Cookies</h4>
              <p className="text-slate-700 text-sm">
                Schools24 does <strong>not</strong> use:
              </p>
              <ul className="text-sm text-slate-700 list-disc list-inside mt-2 space-y-1">
                <li>Analytics cookies (Google Analytics, Mixpanel, etc.)</li>
                <li>Marketing or advertising cookies</li>
                <li>Tracking pixels or behavioral profiling</li>
                <li>Third-party cookies from social media platforms</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Cookie Consent */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Cookie Consent</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-semibold text-slate-900 mb-2">Do You Need to Consent?</h4>
              <p className="text-slate-700 mb-3">
                <strong>No.</strong> Essential cookies do not require your consent. They are necessary for Schools24 to work. You cannot disable them.
              </p>
              <p className="text-slate-700">
                Since Schools24 does not use non-essential cookies, there are no optional cookies to consent to.
              </p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded p-4">
              <h4 className="font-semibold text-blue-900 mb-2">Future Cookie Usage</h4>
              <p className="text-blue-800 text-sm">
                If Schools24 adds optional cookies in the future (e.g., analytics), we will:
              </p>
              <ul className="text-sm text-blue-800 list-disc list-inside mt-2 space-y-1">
                <li>Display a cookie banner on your first visit</li>
                <li>Let you choose which cookies to accept</li>
                <li>Remember your preferences for future visits</li>
                <li>Allow you to change preferences anytime</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Browser Cookie Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">How to Manage Cookies in Your Browser</CardTitle>
            <CardDescription>View, block, or delete cookies on your device</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-semibold text-slate-900 mb-3">Most browsers allow you to:</h4>
              <ul className="text-slate-700 space-y-2 list-disc list-inside">
                <li><strong>View cookies:</strong> See all cookies stored for each website</li>
                <li><strong>Block cookies:</strong> Prevent new cookies from being set</li>
                <li><strong>Delete cookies:</strong> Remove existing cookies from your device</li>
                <li><strong>Manage exceptions:</strong> Allow some websites while blocking others</li>
              </ul>
            </div>

            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <div className="border rounded p-3 bg-slate-50">
                <p className="font-semibold text-slate-900 mb-2">Chrome & Edge</p>
                <ol className="text-sm text-slate-700 list-decimal list-inside space-y-1">
                  <li>Settings → Privacy & Security</li>
                  <li>Cookies & other site data</li>
                  <li>Manage all site data & permissions</li>
                </ol>
              </div>
              <div className="border rounded p-3 bg-slate-50">
                <p className="font-semibold text-slate-900 mb-2">Firefox</p>
                <ol className="text-sm text-slate-700 list-decimal list-inside space-y-1">
                  <li>Preferences → Privacy</li>
                  <li>Cookies & site data</li>
                  <li>Click "Manage Data"</li>
                </ol>
              </div>
              <div className="border rounded p-3 bg-slate-50">
                <p className="font-semibold text-slate-900 mb-2">Safari</p>
                <ol className="text-sm text-slate-700 list-decimal list-inside space-y-1">
                  <li>Preferences → Privacy</li>
                  <li>Manage Website Data</li>
                  <li>Select Schools24 and click Remove</li>
                </ol>
              </div>
              <div className="border rounded p-3 bg-slate-50">
                <p className="font-semibold text-slate-900 mb-2">Mobile (iOS/Android)</p>
                <ol className="text-sm text-slate-700 list-decimal list-inside space-y-1">
                  <li>Settings → Safari/Chrome</li>
                  <li>Clear History & Website Data</li>
                  <li>Or use Incognito/Private Mode</li>
                </ol>
              </div>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded p-4 mt-4">
              <p className="text-sm text-yellow-900">
                <strong>⚠️ Warning:</strong> Deleting or blocking all cookies, including essential ones, may prevent you from logging in to Schools24. If you do this, you'll need to clear exceptions for schools24.in or use Incognito Mode when accessing the platform.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Data Collection Without Cookies */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Data Collection Without Cookies</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-slate-700">
              Even if you block all cookies, Schools24 may still collect certain data for functionality and security:
            </p>
            <ul className="text-slate-700 space-y-2 list-disc list-inside">
              <li><strong>IP Address:</strong> For session security and abuse prevention</li>
              <li><strong>Device Info:</strong> Browser type, OS (for compatibility checking)</li>
              <li><strong>Usage Logs:</strong> Page views, login times (for system optimization)</li>
              <li><strong>Form Data:</strong> Information you enter (obviously)</li>
            </ul>
            <p className="text-slate-700 text-sm mt-4">
              This data is not used for tracking or profiling. It's stored only as long as necessary for functionality and legal compliance.
            </p>
          </CardContent>
        </Card>

        {/* Do Not Track */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Do Not Track (DNT)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-slate-700">
              Schools24 respects the Do Not Track (DNT) signal in your browser. If you enable DNT in your browser settings, we will:
            </p>
            <ul className="text-slate-700 space-y-1 list-disc list-inside">
              <li>Honor your preference to disable analytical tracking</li>
              <li>Not load any behavioral tracking scripts</li>
              <li>Continue to use essential cookies (required for functionality)</li>
            </ul>
            <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm mt-4">
              <p className="text-blue-900">
                <strong>How to enable DNT:</strong> See <a href="https://allaboutdnt.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">allaboutdnt.com</a> for instructions for your browser.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Third-Party Cookies */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Third-Party Cookies</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-slate-700 mb-3">
              Third-party cookies are set by websites other than Schools24 (e.g., if we embed content from YouTube, that domain might set its own cookies).
            </p>

            <div>
              <h4 className="font-semibold text-slate-900 mb-2">Do We Use Third-Party Cookies?</h4>
              <p className="text-slate-700">
                Schools24 does not intentionally embed third-party services that set cookies. However, if Schools24 in the future partners with:
              </p>
              <ul className="text-slate-700 space-y-1 list-disc list-inside mt-2 text-sm">
                <li>Payment processors (Razorpay)</li>
                <li>Learning material providers</li>
                <li>Video hosting services</li>
              </ul>
              <p className="text-slate-700 text-sm mt-2">
                Those services may set cookies. You will be informed in advance, and we will not load these services without your consent.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Contact */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Questions?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-slate-700">
              If you have questions about this cookie policy or want to know more about your privacy:
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded p-3 text-sm">
              <p><strong>Email:</strong> <a href="mailto:privacy@schools24.in" className="text-blue-600 hover:underline">privacy@schools24.in</a></p>
              <p className="text-slate-600">Response time: within 30 days</p>
            </div>

            <p className="text-slate-700 text-sm">
              See our <Link href="/privacy-policy" className="text-blue-600 hover:underline">Privacy Policy</Link> for comprehensive information about how we collect and use data.
            </p>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="border-t pt-8 flex flex-col sm:flex-row gap-4 justify-center sm:justify-between items-center">
          <div className="flex gap-6 text-sm">
            <Link href="/privacy-policy" className="text-blue-600 hover:text-blue-700 hover:underline">
              Privacy Policy
            </Link>
            <Link href="/terms-of-service" className="text-blue-600 hover:text-blue-700 hover:underline">
              Terms of Service
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
