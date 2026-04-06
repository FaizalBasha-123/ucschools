import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import Blogs from './pages/Blogs';
import Blog from './pages/Blog';
import SchoolRegistration from './pages/SchoolRegistration';
import Contact from './pages/Contact';
import SmoothScroll from './components/SmoothScroll';
import About from './pages/About';
import HelpCenter from './pages/HelpCenter';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import SalesPolicy from './pages/SalesPolicy';
import RefundPolicy from './pages/RefundPolicy';
import ChildSafety from './pages/ChildSafety';
import Security from './pages/Security';
import Disclaimer from './pages/Disclaimer';
import Compliance from './pages/Compliance';
import IntellectualProperty from './pages/IntellectualProperty';
import ServiceLevelAgreement from './pages/ServiceLevelAgreement';
import CookieConsentBanner from './components/CookieConsentBanner';
import { initializeConsentMode } from './services/cookieConsent';

const ScrollToTop: React.FC = () => {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname]);

  return null;
};

const App: React.FC = () => {
  useEffect(() => {
    initializeConsentMode();
  }, []);

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SmoothScroll />
      <ScrollToTop />
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/blogs" element={<Blogs />} />
        <Route path="/blog/:slug" element={<Blog />} />
        <Route path="/register" element={<SchoolRegistration />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/about" element={<About />} />
        <Route path="/help-center" element={<HelpCenter />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/terms-of-service" element={<TermsOfService />} />
        <Route path="/sales-policy" element={<SalesPolicy />} />
        <Route path="/refund-policy" element={<RefundPolicy />} />
        <Route path="/child-safety" element={<ChildSafety />} />
        <Route path="/security" element={<Security />} />
        <Route path="/disclaimer" element={<Disclaimer />} />
        <Route path="/compliance" element={<Compliance />} />
        <Route path="/intellectual-property" element={<IntellectualProperty />} />
        <Route path="/service-level-agreement" element={<ServiceLevelAgreement />} />
      </Routes>
      <CookieConsentBanner />
    </Router>
  );
};

export default App;
