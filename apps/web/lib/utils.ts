/**
 * Tiny `className` merger — combines `clsx` (conditional logic) with
 * `tailwind-merge` (conflict resolution so `bg-red-500 bg-blue-500`
 * collapses to `bg-blue-500`). Every component in `components/ui/*`
 * depends on this exact export shape (`cn`).
 */
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
