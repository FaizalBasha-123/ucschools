
import React from 'react';
import { useInView } from '../hooks/useInView';

const KnowUs: React.FC = () => {
    const [ref, isInView] = useInView(0.1);

    const videos = [
        {
            src: "/videos/MySchools Partnering with Ecoblox & Lettuce Build.mp4",
            title: "Partnering with Ecoblox & Lettuce Build"
        },
        {
            src: "/videos/MySchools SAAS Motion Graphic Improved.mp4",
            title: "How It Works"
        }
    ];

    return (
        <section
            ref={ref as React.RefObject<HTMLElement>}
            className={`snap-section relative bg-black text-white py-20 overflow-hidden ${isInView ? 'snap-active' : ''}`}
        >

            <div className="max-w-7xl mx-auto px-6 relative z-10">
                <div className="text-center mb-16">
                    <span className="text-[#f59e0b] font-bold tracking-widest uppercase text-xs mb-4 block animate-on-scroll animate-fade-up">
                        Discover More
                    </span>
                    <h2 className="text-5xl md:text-7xl font-black tracking-tighter animate-on-scroll animate-fade-up delay-100">
                        Know <span className="text-[#f59e0b]">Us</span>
                    </h2>
                </div>

                <div className="grid md:grid-cols-2 gap-8 md:gap-12 animate-on-scroll animate-fade-up delay-200">
                    {videos.map((video, index) => (
                        <div key={index} className="flex flex-col gap-4">
                            <div className="group relative rounded-xl overflow-hidden aspect-video bg-white/5 cursor-pointer">
                                <video
                                    src={video.src}
                                    className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-all duration-500"
                                    controls
                                    controlsList="nodownload"
                                />
                            </div>
                            <h3 className="text-xl md:text-2xl font-bold text-white tracking-tight">{video.title}</h3>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default KnowUs;
