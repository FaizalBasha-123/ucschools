import Link from "next/link"

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-black/95">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6 text-white">
        <Link href="https://schools24.in" className="flex items-center">
          <img src="/Logo.png" alt="Schools24" className="h-[5rem] md:h-[6rem] object-contain -ml-2" />
        </Link>
        <nav className="hidden items-center justify-center gap-8 lg:flex">
          <Link href="https://schools24.in/#partners" className="text-sm font-bold opacity-70 transition-opacity hover:opacity-100">
            Partners
          </Link>
          <Link href="https://schools24.in/#services" className="text-sm font-bold opacity-70 transition-opacity hover:opacity-100">
            Services
          </Link>
          <Link href="https://schools24.in/blogs" className="text-sm font-bold opacity-100">
            Blogs
          </Link>
          <Link href="https://schools24.in/contact" className="text-sm font-bold opacity-70 transition-opacity hover:opacity-100">
            Contact
          </Link>
        </nav>
        <div className="flex items-center justify-end gap-6">
          <Link href="https://dash.schools24.in/login" className="text-sm font-bold opacity-70 transition-opacity hover:opacity-100">
            Log In
          </Link>
        </div>
      </div>
    </header>
  )
}
