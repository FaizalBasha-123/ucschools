
import React from 'react';
import SEOMeta from '../components/SEOMeta';
import Footer from '../components/Footer';

const CONTACT_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'ContactPage',
  name: 'Contact MySchools',
  url: 'https://MySchools.in/contact',
  description: 'Reach out to the MySchools team for demos, partnerships, and support enquiries.',
  contactPoint: {
    '@type': 'ContactPoint',
    telephone: '+91 9110893850',
    email: 'partner@MySchools.in',
    contactType: 'sales',
    areaServed: 'IN',
    availableLanguage: 'en',
  },
};

const Contact: React.FC = () => {
    return (
        <>
        <SEOMeta
          title="Contact MySchools – Get a Demo or Partnership Query"
          description="Reach out to the MySchools team in Bangalore for demos, partnership discussions, and platform support. Email: partner@MySchools.in."
          path="/contact"
          structuredData={CONTACT_SCHEMA}
        />
        <div className="min-h-screen w-full bg-white selection:bg-orange-500 selection:text-white">
            <section className="pt-40 pb-20 px-6 max-w-7xl mx-auto">
                <div className="grid md:grid-cols-2 gap-20 items-center">
                    <div>
                        <span className="text-orange-500 font-bold tracking-widest uppercase text-xs mb-4 block">Get in Touch</span>
                        <h1 className="text-6xl md:text-8xl font-black text-slate-900 tracking-tighter mb-12 leading-[0.9]">
                            Let's build <br />
                            the <span className="text-orange-500">Future.</span>
                        </h1>

                        <div className="space-y-8">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 mb-2">Headquarters</h3>
                                <p className="text-slate-500 font-medium">
                                    Bangalore, Karnataka,<br />
                                    India
                                </p>
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 mb-2">Support</h3>
                                <p className="text-slate-500 font-medium text-lg">
                                    partner@MySchools.in
                                </p>
                                <p className="text-slate-500 font-medium">
                                    +91 9110893850
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="h-[600px] bg-slate-100 rounded-[3rem] overflow-hidden">
                        <iframe
                            title="map"
                            width="100%"
                            height="100%"
                            style={{ border: 0 }}
                            loading="lazy"
                            allowFullScreen
                            referrerPolicy="no-referrer-when-downgrade"
                            src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3151.835434509546!2d144.955925!3d-37.817209!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x6ad642af0f11fd81%3A0xf5776d6e9e7b!2sYour%20Office!5e0!3m2!1sen!2sau!4v1700000000000"
                        />
                    </div>
                </div>
            </section>

            <Footer />
        </div>
        </>
    );
};

export default Contact;
