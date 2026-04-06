import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

const Navbar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === '/';
  const [isHidden, setIsHiddenState] = useState(false);

  // Ref mirror so the scroll handler never has a stale closure
  const isHiddenRef = useRef(false);

  const setIsHidden = (v: boolean) => {
    isHiddenRef.current = v;
    setIsHiddenState(v);
  };

  const handleScroll = (id: string) => {
    if (!isHome) {
      navigate('/');
      setTimeout(() => {
        const element = document.getElementById(id);
        if (element) element.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } else {
      const element = document.getElementById(id);
      if (element) element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Reset on route change
  useEffect(() => {
    setIsHidden(false);
  }, [location.pathname]);

  // Single mount/unmount listener — no dependency on isHidden so it never re-registers
  useEffect(() => {
    const isMobile = () => window.innerWidth < 1024;

    let prevY = window.scrollY;
    let touchStartY = 0;

    const show = () => { if (isHiddenRef.current) setIsHidden(false); };
    const hide = () => { if (!isHiddenRef.current) setIsHidden(true); };

    // PRIMARY: touchmove — fires every frame during active touch on all mobile browsers
    // finger DOWN (dy > 0) = user scrolling toward top = hide header
    // finger UP   (dy < 0) = user scrolling toward bottom = show header
    const onTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isMobile()) return;
      const dy = e.touches[0].clientY - touchStartY;
      if (Math.abs(dy) < 3) return;
      if (dy > 0) hide(); else show();
      touchStartY = e.touches[0].clientY;
    };

    // FALLBACK: scroll event on window — works once CSS fix makes window the scroll container
    const onScroll = () => {
      if (!isMobile()) { show(); prevY = window.scrollY; return; }
      const y = window.scrollY;
      const delta = y - prevY;
      prevY = y;
      if (Math.abs(delta) < 3) return;
      // scrollY increases when scrolling toward bottom = show
      // scrollY decreases when scrolling toward top = hide
      if (delta > 0) show(); else hide();
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-[100] border-b border-white/10 bg-black/95 transition-transform duration-300 ease-out lg:translate-y-0 ${
        isHidden ? '-translate-y-full' : 'translate-y-0'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between text-white">
        <Link to="/" className="flex items-center group cursor-pointer w-48">
          <img src="/Logo.png" alt="MySchools" className="h-[5rem] md:h-[6rem] object-contain -ml-2" />
        </Link>

        {/* Center Links */}
        <div className="hidden lg:flex items-center justify-center gap-8 flex-1">
          {['Partners', 'Services'].map((item) => (
            <button
              key={item}
              onClick={() => handleScroll(item.toLowerCase())}
              className="text-sm font-bold opacity-70 hover:opacity-100 transition-opacity bg-transparent border-none cursor-pointer text-white"
            >
              {item}
            </button>
          ))}
          <Link to="/blogs" className="text-sm font-bold opacity-70 hover:opacity-100 transition-opacity">
            Blogs
          </Link>
          <Link to="/contact" className="text-sm font-bold opacity-70 hover:opacity-100 transition-opacity">
            Contact
          </Link>
        </div>

        {/* Right side CTA */}
        <div className="flex items-center justify-end gap-6 w-48">
          <a href="https://dash.MySchools.in/login" className="text-sm font-bold opacity-70 hover:opacity-100 transition-opacity">
            Log In
          </a>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
