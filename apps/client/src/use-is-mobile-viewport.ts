import { useEffect, useState } from 'react';

const DEFAULT_MOBILE_MEDIA_QUERY = '(max-width: 900px)';

export function useIsMobileViewport(mediaQuery: string = DEFAULT_MOBILE_MEDIA_QUERY): boolean {
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return false;
    }
    return window.matchMedia(mediaQuery).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }

    const query = window.matchMedia(mediaQuery);
    const handleChange = (event: MediaQueryListEvent): void => {
      setIsMobileViewport(event.matches);
    };

    setIsMobileViewport(query.matches);
    query.addEventListener('change', handleChange);
    return () => {
      query.removeEventListener('change', handleChange);
    };
  }, [mediaQuery]);

  return isMobileViewport;
}
