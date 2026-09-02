declare module 'next/font/google' {
  import { NextFontWithVariable } from 'next/dist/compiled/@next/font/dist/types';
  
  export interface InterOptions {
    subsets?: string[];
    weight?: string | string[];
    style?: string | string[];
    display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
    variable?: string;
    preload?: boolean;
    fallback?: string[];
    adjustFontFallback?: boolean;
  }
  
  export function Inter(options?: InterOptions): NextFontWithVariable;
}
