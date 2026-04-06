
import { useEffect, useState, useRef, RefObject } from 'react';

export function useInView(threshold = 0.3): [RefObject<HTMLElement | null>, boolean] {
    const [isInView, setIsInView] = useState(false);
    const ref = useRef<HTMLElement>(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                // Toggle true when entering, false when leaving
                setIsInView(entry.isIntersecting);
            },
            { threshold }
        );

        if (ref.current) {
            observer.observe(ref.current);
        }

        return () => {
            if (ref.current) {
                observer.unobserve(ref.current);
            }
        };
    }, [threshold]);

    return [ref, isInView];
}
