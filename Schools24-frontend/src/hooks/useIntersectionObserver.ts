import { useCallback, useEffect, useState } from 'react'

interface UseIntersectionObserverProps {
    threshold?: number
    root?: Element | null
    rootMargin?: string
}

export function useIntersectionObserver({
    threshold = 0,
    root = null,
    rootMargin = '0%',
}: UseIntersectionObserverProps = {}) {
    const [node, setNode] = useState<Element | null>(null)
    const [inView, setInView] = useState(false)

    const ref = useCallback((element: Element | null) => {
        setNode(element)
    }, [])

    useEffect(() => {
        if (!node) {
            setInView(false)
            return
        }

        const observer = new IntersectionObserver(
            ([entry]) => {
                setInView(entry.isIntersecting)
            },
            {
                threshold,
                root,
                rootMargin,
            }
        )

        observer.observe(node)

        return () => {
            observer.unobserve(node)
            observer.disconnect()
        }
    }, [node, threshold, root, rootMargin])

    return { ref, inView }
}
