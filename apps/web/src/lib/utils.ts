import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins class names and resolves Tailwind conflicts, so `cn("p-2", cond && "p-4")` behaves. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
