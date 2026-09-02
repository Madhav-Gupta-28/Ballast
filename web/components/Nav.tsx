"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Mark from "./Mark";
import ConnectButton from "./ConnectButton";

const LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/markets", label: "Markets" },
  { href: "/app", label: "App" },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      <div className="nav-in">
        <Link className="brand" href="/">
          <Mark />
          <b>Ballast</b>
        </Link>
        <div className="navlinks">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={path === l.href ? "navlink on" : "navlink"}>
              {l.label}
            </Link>
          ))}
        </div>
        <span className="push" />
        <ConnectButton />
      </div>
    </nav>
  );
}
