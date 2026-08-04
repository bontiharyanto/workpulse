'use client';

import { Menu } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type JSX } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

import { AppSidebar } from './app-sidebar';

/**
 * Mobile-only nav: the sidebar re-used verbatim inside a Radix
 * `Sheet` (drawer) that slides in from the left. Auto-closes on
 * pathname change so tapping a link takes the user to the page
 * without leaving the drawer open.
 */
export function MobileNav(): JSX.Element {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Buka menu">
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64 p-0">
        <AppSidebar />
      </SheetContent>
    </Sheet>
  );
}
