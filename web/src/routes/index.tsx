import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { settingsQueryOptions } from "@/lib/refresh";
import { useAuth } from "@/lib/auth";
import { homePathForUser } from "@/lib/auth-destination";
import { isFlutterWebView } from "@/lib/biometric";
import { LoginView } from "@/components/auth/LoginView";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Smartphone,
  Zap,
  Wifi,
  Landmark,
  Coins,
  FileText,
  Plane,
  Shield,
  QrCode,
  Download,
  CheckCircle2,
  ChevronRight,
  TrendingUp,
  Cpu,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Send,
  Receipt,
  UserCheck,
  MapPin,
  PhoneCall,
  Mail,
  Lock,
  ArrowRight,
} from "lucide-react";
import type { LandingPageConfig } from "@/lib/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MySewa — Nepal's Premier Sovereign Digital Wallet & Payment Super-App" },
      {
        name: "description",
        content:
          "MySewa is Nepal's premier digital wallet: instant NTC/Ncell top-up, NEA electricity, Khanepani water, fiber internet, 24/7 bank transfer via NCHL-IPS rails, and global remittance.",
      },
      { property: "og:title", content: "MySewa — Nepal's Premier Sovereign Digital Wallet & Payment Super-App" },
      {
        property: "og:description",
        content:
          "Instant mobile top-up, 24/7 bank transfers, utility bill payments, and international remittance with zero hidden fees.",
      },
    ],
  }),
  component: HomePage,
});

const DEFAULT_LANDING: Required<LandingPageConfig> = {
  hero_badge: "NRB Licensed PSP • NCHL-IPS Integrated • ISO 27001",
  hero_title: "Nepal’s Premier Sovereign Digital Wallet & Payment Super-App",
  hero_subtitle:
    "Instant mobile top-up (NTC & Ncell), NEA electricity, Khanepani water, fiber internet, instant 24/7 bank transfer via NCHL-IPS rails, and global inward remittance — zero hidden fees.",
  hero_cta_primary_text: "Download MySewa App",
  hero_cta_primary_url: "#download-app",
  hero_cta_secondary_text: "Explore Services",
  hero_cta_secondary_url: "#services",
  announcement_enabled: true,
  announcement_text: "⚡ 2% Instant Cashback on NTC & Ncell Mobile Recharges this month! ⚡",
  announcement_link: "#services",
  stat_1_value: "4.8M+",
  stat_1_label: "Active Verified Citizens",
  stat_1_sub: "+22.4% YoY · 77 Districts",
  stat_2_value: "रू 182B+",
  stat_2_label: "Annual Settlement Vol",
  stat_2_sub: "NCHL Interoperable Rails",
  stat_3_value: "99.98%",
  stat_3_label: "Payment Rail Uptime",
  stat_3_sub: "Tier 4 Sovereign Data Center",
  stat_4_value: "< 1.2s",
  stat_4_label: "Avg Transaction Finality",
  stat_4_sub: "Sub-Second IPS Pipeline",
  app_title: "Carry Nepal's Digital Economy in Your Pocket",
  app_subtitle:
    "Download the official MySewa app on Android or iOS. Experience instant biometric authentication, NepalPay dynamic QR payments, and real-time transaction receipts.",
  play_store_url: "https://play.google.com/store/apps/details?id=com.mysewa.wallet",
  app_store_url: "https://apps.apple.com/app/mysewa-nepal/id123456789",
  direct_apk_url: "",
  support_hours: "24/7 Toll-Free & Helpdesk",
  toll_free_number: "1660-01-MYSEWA",
  office_location: "Nagpokhari, Ward 1, Kathmandu, Bagmati Province, Nepal",
  social_facebook: "https://facebook.com/mysewanepal",
  social_whatsapp: "https://wa.me/9779800000000",
  social_telegram: "https://t.me/mysewa_official",
  social_twitter: "https://twitter.com/mysewanepal",
  show_testimonials: true,
  show_faqs: true,
  faqs: [
    {
      question: "How do I complete biometric KYC verification in MySewa?",
      answer:
        "You can complete your KYC in under 90 seconds by scanning your Nepali Citizenship (Nagarikta), National Identity Card (NID), or Passport along with a live selfie verification directly in the MySewa app.",
    },
    {
      question: "Are bank transfers via NCHL-IPS available on public holidays and weekends?",
      answer:
        "Yes. All bank transfers on MySewa operate on NCHL-IPS 24/7 real-time settlement rails and are credited instantly, including Saturdays, public holidays, and midnight.",
    },
    {
      question: "What are the charges for mobile top-up and utility bills?",
      answer:
        "Mobile recharge on NTC, Ncell, and Smart Cell has 0% service charge and comes with up to 2% instant cashback. NEA electricity and Khanepani water bill payments have zero service fees.",
    },
    {
      question: "Can I receive international remittances directly into my wallet?",
      answer:
        "Yes, MySewa partners with leading international money transfer operators across the GCC, USA, UK, Japan, Australia, Malaysia, and Korea for direct inward wallet deposits.",
    },
    {
      question: "How does MySewa protect my funds and personal data?",
      answer:
        "MySewa is regulated under the Nepal Rastra Bank Payment Systems Department, with bank-grade 256-bit encryption, biometric device binding, and real-time AI fraud detection.",
    },
  ],
};

function HomePage() {
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [nepalTime, setNepalTime] = useState("");
  const [serviceCategory, setServiceCategory] = useState<"all" | "telecom" | "utilities" | "banking" | "gov">("all");

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient.settings(),
    ...settingsQueryOptions(),
  });

  const settings = settingsQuery.data;
  const config = settings?.config;
  const landing = useMemo(() => {
    return {
      ...DEFAULT_LANDING,
      ...(config?.landing_page || {}),
    };
  }, [config?.landing_page]);

  const logoUrl = settings?.logo_url || "/logo.png";
  const apkDownloadUrl = landing.direct_apk_url || settings?.apk_url || "";

  // Real-time Nepal Standard Time clock (NPT GMT+5:45)
  useEffect(() => {
    const updateTime = () => {
      try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Kathmandu",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });
        setNepalTime(formatter.format(now));
      } catch {
        setNepalTime(new Date().toLocaleTimeString());
      }
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Open login dialog automatically if ?login=true or hash is #login
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("login") === "true" || window.location.hash === "#login") {
        setLoginModalOpen(true);
      }
    }
  }, []);

  // Flutter WebView native container: Render LoginView directly so app operates seamlessly
  if (isFlutterWebView()) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <LoginView />
      </div>
    );
  }

  const servicesList = [
    {
      id: "topup",
      category: "telecom",
      title: "Mobile Top-Up & 5G Data",
      desc: "Recharge Nepal Telecom (Namaste), Ncell Axiata, and Smart Cell with instant balance credit.",
      tag: "2% Cashback",
      tagHighlight: true,
      meta: "0% Fee • Instant",
      action: "Top-Up Now",
      icon: Smartphone,
      accent: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    },
    {
      id: "electricity",
      category: "utilities",
      title: "NEA Electricity & Water",
      desc: "Nepal Electricity Authority smart counter bill settlement and KUKL water boards across 77 districts.",
      tag: "77 Districts",
      tagHighlight: false,
      meta: "Smart Meter Sync",
      action: "Pay Bill",
      icon: Zap,
      accent: "text-amber-400 bg-amber-500/10 border-amber-500/30",
    },
    {
      id: "internet",
      category: "telecom",
      title: "Fiber Internet Renewal",
      desc: "Instant ISP subscription renewal for WorldLink, Vianet, Subisu, DishHome Fiber, & Classic Tech.",
      tag: "Fiber Direct",
      tagHighlight: true,
      meta: "Zero Downtime",
      action: "Renew Plan",
      icon: Wifi,
      accent: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30",
    },
    {
      id: "transfer",
      category: "banking",
      title: "24/7 National Bank Transfers",
      desc: "Direct transfer to Nabil, Global IME, NIC Asia, Himalayan Bank, and 30+ licensed commercial banking rails.",
      tag: "NCHL-IPS Rails",
      tagHighlight: false,
      meta: "Instant Finality",
      action: "Transfer Funds",
      icon: Landmark,
      accent: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    },
    {
      id: "remittance",
      category: "banking",
      title: "Global Remittance Inward",
      desc: "Receive money directly from GCC, USA, UK, Japan, Australia, Malaysia, and Korea into MySewa wallet.",
      tag: "GCC • USA • AUS",
      tagHighlight: true,
      meta: "Direct Deposit",
      action: "Claim Remit",
      icon: Coins,
      accent: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
    },
    {
      id: "government",
      category: "gov",
      title: "Government & Traffic Challan",
      desc: "Clear Nepal Traffic Police fines, Inland Revenue Dept (IRD) taxes, and Lok Sewa Aayog exam revenues.",
      tag: "Official Receipt",
      tagHighlight: false,
      meta: "Direct Govt Rail",
      action: "Clear Challan",
      icon: FileText,
      accent: "text-blue-400 bg-blue-500/10 border-blue-500/30",
    },
    {
      id: "flights",
      category: "utilities",
      title: "Domestic Flights & Travel",
      desc: "Instant domestic flight bookings for Buddha Air, Yeti Airlines, Shree Airlines, and inter-district bus seats.",
      tag: "E-Ticket via SMS",
      tagHighlight: true,
      meta: "Best Fare Lock",
      action: "Book Ticket",
      icon: Plane,
      accent: "text-sky-400 bg-sky-500/10 border-sky-500/30",
    },
    {
      id: "insurance",
      category: "banking",
      title: "Insurance & Credit Card EMI",
      desc: "Nepal Life, Shikhar, MetLife policy premium settlement and commercial bank credit card bill clearing.",
      tag: "NRB Licensed",
      tagHighlight: false,
      meta: "Instant Receipt",
      action: "Pay Premium",
      icon: Shield,
      accent: "text-purple-400 bg-purple-500/10 border-purple-500/30",
    },
  ];

  const filteredServices = servicesList.filter((s) => {
    if (serviceCategory === "all") return true;
    return s.category === serviceCategory;
  });

  return (
    <div className="min-h-screen bg-[#0b111e] text-[#f1f5f9] selection:bg-emerald-500 selection:text-black font-sans antialiased flex flex-col">
      {/* 1. ANNOUNCEMENT NOTICE BAR (DYNAMIC) */}
      {landing.announcement_enabled && landing.announcement_text && (
        <aside
          aria-label="Announcement"
          className="bg-emerald-950/80 border-b border-emerald-500/30 py-2 px-4 text-center text-xs sm:text-sm font-medium text-emerald-200 flex items-center justify-center gap-2"
        >
          <span className="inline-block size-2 rounded-full bg-emerald-400 animate-pulse" />
          {landing.announcement_link ? (
            <a
              href={landing.announcement_link}
              className="hover:underline flex items-center gap-1.5 transition-colors"
            >
              <span>{landing.announcement_text}</span>
              <ExternalLink className="size-3.5" />
            </a>
          ) : (
            <span>{landing.announcement_text}</span>
          )}
        </aside>
      )}

      {/* 2. TOP NAVIGATION BAR */}
      <header className="sticky top-0 z-50 bg-[#0b111e]/90 backdrop-blur-md border-b border-white/10 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between">
          {/* Brand Logo & Sovereign Telemetry */}
          <div className="flex items-center gap-4 sm:gap-6">
            <Link to="/" className="flex items-center gap-3 group">
              <div className="size-9 sm:size-10 rounded-lg bg-[#151e32] border border-emerald-500/40 p-1.5 flex items-center justify-center shadow-[0_0_15px_rgba(16,185,129,0.25)] group-hover:border-emerald-400 transition-all">
                <img src={logoUrl} alt="MySewa" className="size-full object-contain rounded" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-lg sm:text-xl font-bold tracking-tight text-white group-hover:text-emerald-400 transition-colors">
                    MySewa
                  </span>
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase">
                    NP
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 tracking-wider uppercase font-mono hidden sm:inline-block">
                  Sovereign Digital Pay
                </span>
              </div>
            </Link>

            {/* Nepal Standard Time Telemetry Pill */}
            <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded bg-[#151e32] border border-white/10 text-xs font-mono">
              <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-400">NRB-PSD • NPT GMT+5:45</span>
              <span className="text-emerald-400 font-bold pl-1 tabular-nums">{nepalTime || "14:32:00"}</span>
            </div>
          </div>

          {/* Navigation Anchors */}
          <nav className="hidden md:flex items-center gap-6 lg:gap-8 text-sm font-medium text-slate-300">
            <a href="#services" className="hover:text-emerald-400 transition-colors">
              Services
            </a>
            <a href="#how-it-works" className="hover:text-emerald-400 transition-colors">
              How It Works
            </a>
            <a href="#security" className="hover:text-emerald-400 transition-colors">
              Security & NRB
            </a>
            <a href="#download-app" className="hover:text-emerald-400 transition-colors">
              Mobile App
            </a>
            <a href="#faq" className="hover:text-emerald-400 transition-colors">
              FAQ
            </a>
            <a href="#contact" className="hover:text-emerald-400 transition-colors">
              Contact
            </a>
          </nav>

          {/* Action CTAs */}
          <div className="flex items-center gap-3">
            {token && user ? (
              <Button
                onClick={() => navigate({ to: homePathForUser(user) })}
                className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <UserCheck className="size-4" />
                <span>Go to Wallet</span>
              </Button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setLoginModalOpen(true)}
                  className="px-3.5 py-2 rounded-md text-xs sm:text-sm font-medium border border-white/20 text-slate-200 hover:border-emerald-400 hover:bg-emerald-500/10 transition-all cursor-pointer"
                >
                  Sign In
                </button>
                <Link
                  to="/register"
                  className="px-4 py-2 rounded-md text-xs sm:text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 text-black shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-all flex items-center gap-1.5"
                >
                  <span>Register</span>
                  <ArrowRight className="size-3.5" />
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* 3. HERO SECTION */}
      <section className="relative overflow-hidden pt-12 pb-20 lg:pt-20 lg:pb-28">
        {/* Luminous Glow Orbs */}
        <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 size-96 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-10 right-10 size-[450px] bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Left Column: Headlines & CTAs */}
            <div className="lg:col-span-7 space-y-6 text-center lg:text-left">
              {/* Trust Badge */}
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#151e32] border border-emerald-500/40 text-xs font-mono text-emerald-300">
                <span className="size-2 rounded-full bg-emerald-400 animate-ping" />
                <span>{landing.hero_badge}</span>
              </div>

              {/* Main Headline */}
              <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-tight">
                {landing.hero_title}
              </h1>

              {/* Subtitle */}
              <p className="text-base sm:text-lg text-slate-300 leading-relaxed max-w-2xl mx-auto lg:mx-0">
                {landing.hero_subtitle}
              </p>

              {/* Dual Action Buttons */}
              <div className="pt-2 flex flex-wrap items-center justify-center lg:justify-start gap-4">
                <a
                  href={landing.hero_cta_primary_url || "#download-app"}
                  className="px-6 py-3.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm sm:text-base shadow-[0_0_25px_rgba(16,185,129,0.35)] active:scale-[0.98] transition-all flex items-center gap-2.5"
                >
                  <Download className="size-5" />
                  <span>{landing.hero_cta_primary_text || "Download MySewa App"}</span>
                </a>

                <a
                  href={landing.hero_cta_secondary_url || "#services"}
                  className="px-5 py-3.5 rounded-lg bg-[#151e32] hover:bg-[#1e293b] text-white border border-white/20 hover:border-emerald-400 transition-all text-sm sm:text-base font-semibold flex items-center gap-2"
                >
                  <span>{landing.hero_cta_secondary_text || "Explore Services"}</span>
                  <ChevronRight className="size-4" />
                </a>

                <button
                  type="button"
                  onClick={() => setLoginModalOpen(true)}
                  className="px-4 py-3.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/30 text-sm font-semibold flex items-center gap-2 cursor-pointer transition-colors"
                >
                  <Lock className="size-4 text-emerald-400" />
                  <span>Sign In to Wallet</span>
                </button>
              </div>

              {/* Settlement Backbone Network Bar */}
              <div className="pt-6 border-t border-white/10 flex flex-wrap items-center justify-center lg:justify-start gap-x-6 gap-y-2 text-xs font-mono text-slate-400">
                <span className="text-slate-500 uppercase tracking-wider font-semibold">Settlement Rails:</span>
                <span className="flex items-center gap-1.5 text-slate-300">
                  <span className="size-1.5 rounded-full bg-emerald-400" /> NCHL connectIPS
                </span>
                <span className="flex items-center gap-1.5 text-slate-300">
                  <span className="size-1.5 rounded-full bg-emerald-400" /> Nepal Telecom (NTC)
                </span>
                <span className="flex items-center gap-1.5 text-slate-300">
                  <span className="size-1.5 rounded-full bg-emerald-400" /> Ncell Axiata
                </span>
                <span className="flex items-center gap-1.5 text-slate-300">
                  <span className="size-1.5 rounded-full bg-emerald-400" /> 30+ Banks
                </span>
              </div>
            </div>

            {/* Right Column: High-Tech Glass Fintech Mockup */}
            <div className="lg:col-span-5 relative">
              <div className="relative rounded-2xl bg-[#121824]/90 backdrop-blur-xl border border-white/15 p-6 shadow-2xl space-y-5">
                {/* Mockup Header */}
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="size-3 rounded-full bg-rose-500/80" />
                    <span className="size-3 rounded-full bg-amber-500/80" />
                    <span className="size-3 rounded-full bg-emerald-500/80" />
                    <span className="text-xs font-mono text-slate-400 pl-2">MYSEWA_NODE_KTM_01</span>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    ACTIVE VAULT
                  </span>
                </div>

                {/* Available Balance Display */}
                <div className="rounded-xl bg-[#090e18] border border-white/10 p-5 space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
                        Total Available Balance
                      </span>
                      <div className="text-2xl sm:text-3xl font-mono font-bold text-white tracking-tight mt-1">
                        रू 128,450<span className="text-emerald-400">.00</span>
                      </div>
                    </div>
                    <div className="size-10 rounded-lg bg-[#151e32] border border-white/10 flex items-center justify-center text-emerald-400">
                      <QrCode className="size-5" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs font-mono text-slate-400">
                    <span>A/C: 9841••••4421</span>
                    <span className="text-emerald-400 font-semibold flex items-center gap-1">
                      <ShieldCheck className="size-3.5" />
                      Tier 3 KYC Verified
                    </span>
                  </div>
                </div>

                {/* Quick Action Buttons */}
                <div className="grid grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => setLoginModalOpen(true)}
                    className="flex flex-col items-center justify-center p-2.5 rounded-lg bg-[#151e32] border border-white/10 hover:border-emerald-400/50 hover:bg-[#1a253d] transition-all group cursor-pointer"
                  >
                    <Send className="size-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-medium text-slate-200 mt-1">Send</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLoginModalOpen(true)}
                    className="flex flex-col items-center justify-center p-2.5 rounded-lg bg-[#151e32] border border-white/10 hover:border-emerald-400/50 hover:bg-[#1a253d] transition-all group cursor-pointer"
                  >
                    <Smartphone className="size-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-medium text-slate-200 mt-1">Top-Up</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLoginModalOpen(true)}
                    className="flex flex-col items-center justify-center p-2.5 rounded-lg bg-[#151e32] border border-white/10 hover:border-emerald-400/50 hover:bg-[#1a253d] transition-all group cursor-pointer"
                  >
                    <Receipt className="size-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-medium text-slate-200 mt-1">Pay Bills</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLoginModalOpen(true)}
                    className="flex flex-col items-center justify-center p-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-semibold transition-all group cursor-pointer shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                  >
                    <QrCode className="size-4 group-hover:scale-110 transition-transform" />
                    <span className="text-xs mt-1">Scan QR</span>
                  </button>
                </div>

                {/* Live Settlement Telemetry Feed */}
                <div className="space-y-2 pt-1">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 flex items-center justify-between">
                    <span>Live Settlement Telemetry</span>
                    <span className="text-emerald-400">Real-Time ACK</span>
                  </div>

                  <div className="p-2.5 rounded-lg bg-[#090e18] border border-white/10 flex items-center justify-between text-xs font-mono">
                    <div className="flex items-center gap-2.5">
                      <div className="size-7 rounded bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                        <Zap className="size-3.5" />
                      </div>
                      <div>
                        <div className="text-white font-medium">NEA Electricity Payment</div>
                        <div className="text-slate-500 text-[10px]">TXID: #NEA-8839210 • 12s ago</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-emerald-400 font-bold">NPR 3,420.00</div>
                      <span className="text-[10px] text-slate-400">Settled 200 OK</span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-[#090e18] border border-white/10 flex items-center justify-between text-xs font-mono">
                    <div className="flex items-center gap-2.5">
                      <div className="size-7 rounded bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                        <Smartphone className="size-3.5" />
                      </div>
                      <div>
                        <div className="text-white font-medium">NTC 5G Unlimited Pack</div>
                        <div className="text-slate-500 text-[10px]">TXID: #NTC-509184 • 48s ago</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-white font-bold">NPR 500.00</div>
                      <span className="text-[10px] text-emerald-400">+2% Cashback</span>
                    </div>
                  </div>
                </div>

                {/* Regulatory pill */}
                <div className="text-center text-[11px] font-mono text-slate-400 pt-2 border-t border-white/10">
                  Protected by 256-Bit TLS • Nepal Rastra Bank Regulated Rails
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. LIVE PLATFORM TELEMETRY & TRUST BAR (DYNAMIC STATS) */}
      <section className="border-y border-white/10 bg-[#0e1524]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Stat 1 */}
            <div className="p-5 rounded-xl bg-[#151e32]/80 border border-white/10 hover:border-emerald-500/40 transition-colors space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-slate-400">{landing.stat_1_label}</span>
                <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
              </div>
              <div className="text-3xl font-mono font-bold text-white tracking-tight">{landing.stat_1_value}</div>
              <div className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                <TrendingUp className="size-3.5" />
                <span>{landing.stat_1_sub}</span>
              </div>
            </div>

            {/* Stat 2 */}
            <div className="p-5 rounded-xl bg-[#151e32]/80 border border-white/10 hover:border-emerald-500/40 transition-colors space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-slate-400">{landing.stat_2_label}</span>
                <span className="size-2 rounded-full bg-cyan-400 animate-pulse" />
              </div>
              <div className="text-3xl font-mono font-bold text-emerald-400 tracking-tight">{landing.stat_2_value}</div>
              <div className="text-xs text-slate-300 font-medium">{landing.stat_2_sub}</div>
            </div>

            {/* Stat 3 */}
            <div className="p-5 rounded-xl bg-[#151e32]/80 border border-white/10 hover:border-emerald-500/40 transition-colors space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-slate-400">{landing.stat_3_label}</span>
                <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
              </div>
              <div className="text-3xl font-mono font-bold text-white tracking-tight">{landing.stat_3_value}</div>
              <div className="text-xs text-emerald-400 font-semibold">{landing.stat_3_sub}</div>
            </div>

            {/* Stat 4 */}
            <div className="p-5 rounded-xl bg-[#151e32]/80 border border-white/10 hover:border-emerald-500/40 transition-colors space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-slate-400">{landing.stat_4_label}</span>
                <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
              </div>
              <div className="text-3xl font-mono font-bold text-emerald-400 tracking-tight">{landing.stat_4_value}</div>
              <div className="text-xs text-slate-300 font-medium">{landing.stat_4_sub}</div>
            </div>
          </div>
        </div>
      </section>

      {/* 5. QUICK SERVICES & UTILITIES ECOSYSTEM GRID */}
      <section id="services" className="py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8 w-full">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-white/10 pb-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-emerald-400">
              <Cpu className="size-4" />
              <span>National Payment Grid</span>
            </div>
            <h2 className="text-2xl sm:text-4xl font-bold text-white tracking-tight">
              Ecosystem Services & Utility Rails
            </h2>
            <p className="text-sm text-slate-400 max-w-xl">
              Direct sovereign integrations with Nepal Telecom, Ncell, NEA Smart Meters, Khanepani, and 30+ licensed commercial banks.
            </p>
          </div>

          {/* Filter Tabs */}
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { id: "all", label: "All Sectors" },
                { id: "telecom", label: "Telecom & Data" },
                { id: "utilities", label: "Utilities" },
                { id: "banking", label: "Banking & Remit" },
                { id: "gov", label: "Government" },
              ] as const
            ).map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setServiceCategory(cat.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-all cursor-pointer ${
                  serviceCategory === cat.id
                    ? "bg-emerald-500 text-black font-semibold shadow-[0_0_12px_rgba(16,185,129,0.3)]"
                    : "bg-[#151e32] text-slate-300 hover:text-white hover:bg-[#1f2b45]"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Bento Grid Layout of Services */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {filteredServices.map((service) => {
            const Icon = service.icon;
            return (
              <div
                key={service.id}
                className="rounded-xl bg-[#121824] border border-white/10 p-6 flex flex-col justify-between hover:border-emerald-500/50 hover:bg-[#161f30] transition-all group"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className={`size-11 rounded-lg border p-2 flex items-center justify-center transition-all group-hover:scale-105 ${service.accent}`}>
                      <Icon className="size-5" />
                    </div>
                    <span
                      className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
                        service.tagHighlight
                          ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                          : "bg-white/5 text-slate-300 border-white/10"
                      }`}
                    >
                      {service.tag}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-white group-hover:text-emerald-400 transition-colors">
                      {service.title}
                    </h3>
                    <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
                      {service.desc}
                    </p>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-500">{service.meta}</span>
                  <button
                    type="button"
                    onClick={() => setLoginModalOpen(true)}
                    className="text-emerald-400 font-semibold flex items-center gap-1 group-hover:translate-x-1 transition-transform cursor-pointer"
                  >
                    <span>{service.action}</span>
                    <ChevronRight className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 6. STEP-BY-STEP: HOW MYSEWA WORKS */}
      <section id="how-it-works" className="py-20 bg-[#0e1524] border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <span className="text-xs font-mono uppercase tracking-wider text-emerald-400 font-semibold">
              Instant Onboarding
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              Get Started in 3 Frictionless Steps
            </h2>
            <p className="text-sm text-slate-400">
              Compliant with Nepal Rastra Bank digital payment guidelines and designed for instant completion.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Step 1 */}
            <div className="p-6 rounded-xl bg-[#151e32] border border-white/10 relative space-y-4">
              <div className="size-10 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 font-mono font-bold flex items-center justify-center text-sm">
                01
              </div>
              <h3 className="text-lg font-bold text-white">Instant KYC in 90 Seconds</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Scan your Nepali Citizenship (Nagarikta), National Identity Card (NID), or Passport with live selfie verification for instant account elevation.
              </p>
              <div className="text-xs font-mono text-emerald-400 pt-2 flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5" />
                <span>AI Identity Verification</span>
              </div>
            </div>

            {/* Step 2 */}
            <div className="p-6 rounded-xl bg-[#151e32] border border-white/10 relative space-y-4">
              <div className="size-10 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 font-mono font-bold flex items-center justify-center text-sm">
                02
              </div>
              <h3 className="text-lg font-bold text-white">Load Funds Effortlessly</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Deposit money via mobile banking, Fonepay QR, connectIPS, eSewa, Khalti, or cash load at 15,000+ verified MySewa dealer points nationwide.
              </p>
              <div className="text-xs font-mono text-emerald-400 pt-2 flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5" />
                <span>Zero Load Surcharge</span>
              </div>
            </div>

            {/* Step 3 */}
            <div className="p-6 rounded-xl bg-[#151e32] border border-white/10 relative space-y-4">
              <div className="size-10 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 font-mono font-bold flex items-center justify-center text-sm">
                03
              </div>
              <h3 className="text-lg font-bold text-white">Transact & Earn Rewards</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Scan NepalPay QR at 250,000+ merchants, recharge phones, clear utility bills, send instant bank transfers, and earn real cashback coins.
              </p>
              <div className="text-xs font-mono text-emerald-400 pt-2 flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5" />
                <span>Instant Receipt + Cashback</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 7. BANK-GRADE SECURITY & DEVELOPER ARCHITECTURE */}
      <section id="security" className="py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Security Highlights */}
          <div className="lg:col-span-6 space-y-6">
            <span className="text-xs font-mono uppercase tracking-wider text-emerald-400 font-semibold">
              Bank-Grade Infrastructure
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              Regulated, Encrypted & Sovereign
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              MySewa operates with institutional security standards to protect individual users, high-volume merchants, and remittance operators across Nepal.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="p-4 rounded-lg bg-[#121824] border border-white/10 space-y-2">
                <ShieldCheck className="size-6 text-emerald-400" />
                <h4 className="text-sm font-bold text-white">256-Bit TLS Encryption</h4>
                <p className="text-xs text-slate-400">Military-grade cryptographic tunnel safeguarding every financial transaction.</p>
              </div>

              <div className="p-4 rounded-lg bg-[#121824] border border-white/10 space-y-2">
                <Landmark className="size-6 text-emerald-400" />
                <h4 className="text-sm font-bold text-white">NRB Regulated Rails</h4>
                <p className="text-xs text-slate-400">Licensed under Nepal Rastra Bank Payment Systems Department directives.</p>
              </div>

              <div className="p-4 rounded-lg bg-[#121824] border border-white/10 space-y-2">
                <RefreshCw className="size-6 text-emerald-400" />
                <h4 className="text-sm font-bold text-white">NCHL-IPS Interoperability</h4>
                <p className="text-xs text-slate-400">National Clearing House direct coupling for real-time 24/7 bank settlement.</p>
              </div>

              <div className="p-4 rounded-lg bg-[#121824] border border-white/10 space-y-2">
                <Lock className="size-6 text-emerald-400" />
                <h4 className="text-sm font-bold text-white">Biometric Hardware Lock</h4>
                <p className="text-xs text-slate-400">Device biometric binding ensures zero unauthorized fund movement.</p>
              </div>
            </div>
          </div>

          {/* Developer Terminal API Snippet */}
          <div className="lg:col-span-6">
            <div className="rounded-xl bg-[#090e18] border border-white/15 overflow-hidden shadow-2xl">
              <div className="bg-[#121824] px-4 py-3 border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full bg-rose-500/80" />
                  <span className="size-2.5 rounded-full bg-amber-500/80" />
                  <span className="size-2.5 rounded-full bg-emerald-500/80" />
                  <span className="text-xs font-mono text-slate-400 pl-2">MySewa Merchant API</span>
                </div>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  POST /v1/checkout/create
                </span>
              </div>
              <pre className="p-5 text-xs font-mono text-emerald-300 leading-relaxed overflow-x-auto">
{`curl -X POST https://api.mysewa.com.np/v1/checkout/create \\
  -H "Authorization: Bearer mysewa_live_sec_key_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 1500.00,
    "currency": "NPR",
    "order_id": "ORD-KTM-2026-9041",
    "customer": {
      "phone": "+977 9841234567",
      "name": "Suman Shrestha"
    },
    "return_url": "https://merchant.np/checkout/callback"
  }'

# 200 OK — Response Status:
{
  "status": "success",
  "checkout_url": "https://pay.mysewa.com.np/c/token_88921",
  "qr_payload": "nepalpay://pay?acc=9841234567&amt=1500"
}`}
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* 8. MOBILE APP SHOWCASE & DOWNLOAD SECTION (DYNAMIC) */}
      <section id="download-app" className="py-20 bg-gradient-to-b from-[#0b111e] via-[#0d1627] to-[#0b111e] border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl bg-gradient-to-r from-[#121c2e] to-[#16253d] border border-emerald-500/30 p-8 sm:p-12 lg:p-16 relative overflow-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-8 space-y-6">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-xs font-mono text-emerald-400">
                  <Smartphone className="size-4" />
                  <span>Available on Android & iOS</span>
                </div>

                <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight leading-tight">
                  {landing.app_title}
                </h2>

                <p className="text-base text-slate-300 leading-relaxed max-w-2xl">
                  {landing.app_subtitle}
                </p>

                <div className="flex flex-wrap items-center gap-4 pt-2">
                  {/* Google Play */}
                  <a
                    href={landing.play_store_url}
                    target="_blank"
                    rel="noreferrer"
                    className="px-5 py-3 rounded-lg bg-[#090e18] hover:bg-[#151e32] border border-white/15 hover:border-emerald-400 text-white font-semibold text-xs sm:text-sm flex items-center gap-2.5 transition-all"
                  >
                    <Download className="size-4 text-emerald-400" />
                    <div className="text-left">
                      <div className="text-[10px] text-slate-400 uppercase">GET IT ON</div>
                      <div className="font-bold">Google Play</div>
                    </div>
                  </a>

                  {/* App Store */}
                  <a
                    href={landing.app_store_url}
                    target="_blank"
                    rel="noreferrer"
                    className="px-5 py-3 rounded-lg bg-[#090e18] hover:bg-[#151e32] border border-white/15 hover:border-emerald-400 text-white font-semibold text-xs sm:text-sm flex items-center gap-2.5 transition-all"
                  >
                    <Download className="size-4 text-emerald-400" />
                    <div className="text-left">
                      <div className="text-[10px] text-slate-400 uppercase">Download on the</div>
                      <div className="font-bold">Apple App Store</div>
                    </div>
                  </a>

                  {/* Direct APK Download */}
                  {apkDownloadUrl ? (
                    <a
                      href={apkDownloadUrl}
                      download
                      className="px-5 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs sm:text-sm shadow-[0_0_20px_rgba(16,185,129,0.35)] flex items-center gap-2 transition-all"
                    >
                      <Download className="size-4" />
                      <span>Direct Android APK {settings?.app_version ? `(v${settings.app_version})` : ""}</span>
                    </a>
                  ) : null}
                </div>
              </div>

              {/* Scannable QR Code */}
              <div className="lg:col-span-4 flex justify-center">
                <div className="p-6 rounded-2xl bg-[#090e18] border border-white/15 text-center space-y-3 shadow-xl">
                  <div className="size-44 sm:size-48 mx-auto bg-white p-3 rounded-xl flex items-center justify-center">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
                        apkDownloadUrl || landing.play_store_url || "https://mysewa.sewabyapar.com"
                      )}`}
                      alt="Scan to Download MySewa"
                      className="size-full object-contain"
                    />
                  </div>
                  <div className="text-xs font-mono text-slate-300">
                    <span className="text-emerald-400 font-bold">Scan to Download</span>
                    <p className="text-[11px] text-slate-500 mt-0.5">iOS & Android Compatible</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 9. FREQUENTLY ASKED QUESTIONS (DYNAMIC ACCORDION) */}
      {landing.show_faqs && (landing.faqs || []).length > 0 && (
        <section id="faq" className="py-20 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8 w-full">
          <div className="text-center space-y-2">
            <span className="text-xs font-mono uppercase tracking-wider text-emerald-400 font-semibold">
              Clear Guidance
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              Frequently Asked Questions
            </h2>
            <p className="text-sm text-slate-400">
              Everything you need to know about MySewa fees, KYC verification, limits, and security.
            </p>
          </div>

          <Accordion type="single" collapsible className="space-y-4">
            {(landing.faqs || []).map((faq, idx) => (
              <AccordionItem
                key={idx}
                value={`item-${idx}`}
                className="rounded-xl bg-[#121824] border border-white/10 px-5 py-2 hover:border-emerald-500/40 transition-colors"
              >
                <AccordionTrigger className="text-sm sm:text-base font-bold text-white hover:text-emerald-400 no-underline hover:no-underline">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-xs sm:text-sm text-slate-300 leading-relaxed pt-2 border-t border-white/5">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      )}

      {/* 10. COMPREHENSIVE FOOTER & CONTACT (DYNAMIC) */}
      <footer id="contact" className="mt-auto bg-[#070b14] border-t border-white/10 pt-16 pb-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8">
            {/* Col 1: Brand & Bio */}
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-lg bg-[#151e32] border border-emerald-500/40 p-1.5 flex items-center justify-center">
                  <img src={logoUrl} alt="MySewa" className="size-full object-contain rounded" />
                </div>
                <span className="text-xl font-bold tracking-tight text-white">MySewa</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed max-w-sm">
                Nepal’s trusted digital wallet and sovereign payment gateway. Licensed by Nepal Rastra Bank (NRB) Payment Systems Department and inter-connected with NCHL-IPS.
              </p>
              <div className="flex items-center gap-3 pt-2 text-slate-400">
                {landing.social_whatsapp && (
                  <a
                    href={landing.social_whatsapp}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2 rounded bg-[#121824] hover:text-emerald-400 hover:bg-[#1a253a] transition-colors"
                    title="WhatsApp Support"
                  >
                    <PhoneCall className="size-4" />
                  </a>
                )}
                {landing.social_facebook && (
                  <a
                    href={landing.social_facebook}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2 rounded bg-[#121824] hover:text-emerald-400 hover:bg-[#1a253a] transition-colors"
                    title="Facebook Page"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                )}
                {landing.social_telegram && (
                  <a
                    href={landing.social_telegram}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2 rounded bg-[#121824] hover:text-emerald-400 hover:bg-[#1a253a] transition-colors"
                    title="Telegram Channel"
                  >
                    <Send className="size-4" />
                  </a>
                )}
              </div>
            </div>

            {/* Col 2: Quick Links */}
            <div className="space-y-3 text-xs">
              <span className="font-mono uppercase tracking-wider text-white font-bold">Services</span>
              <ul className="space-y-2 text-slate-400">
                <li><a href="#services" className="hover:text-emerald-400">Mobile Top-Up & Data</a></li>
                <li><a href="#services" className="hover:text-emerald-400">NEA Electricity Bill</a></li>
                <li><a href="#services" className="hover:text-emerald-400">Fiber Internet Renewal</a></li>
                <li><a href="#services" className="hover:text-emerald-400">24/7 Bank Transfer</a></li>
                <li><a href="#services" className="hover:text-emerald-400">Inward Remittance</a></li>
              </ul>
            </div>

            {/* Col 3: Portal & Legal */}
            <div className="space-y-3 text-xs">
              <span className="font-mono uppercase tracking-wider text-white font-bold">Ecosystem</span>
              <ul className="space-y-2 text-slate-400">
                <li><button type="button" onClick={() => setLoginModalOpen(true)} className="hover:text-emerald-400 text-left cursor-pointer">Customer Sign In</button></li>
                <li><Link to="/register" className="hover:text-emerald-400">Create Account</Link></li>
                <li><Link to="/dealer" className="hover:text-emerald-400">Dealer & Agent Portal</Link></li>
                <li><Link to="/admin" className="hover:text-emerald-400">Super Admin Console</Link></li>
                <li><a href="#download-app" className="hover:text-emerald-400">Android APK Download</a></li>
              </ul>
            </div>

            {/* Col 4: Contact & Office */}
            <div className="space-y-3 text-xs">
              <span className="font-mono uppercase tracking-wider text-white font-bold">HQ & Support</span>
              <div className="space-y-2.5 text-slate-400">
                <div className="flex items-start gap-2">
                  <MapPin className="size-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>{landing.office_location}</span>
                </div>
                <div className="flex items-center gap-2">
                  <PhoneCall className="size-4 text-emerald-400 shrink-0" />
                  <span>{landing.toll_free_number}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="size-4 text-emerald-400 shrink-0" />
                  <span>{config?.site?.support_email || "support@mysewa.com.np"}</span>
                </div>
                <div className="text-[11px] text-slate-500 font-mono pt-1">
                  {landing.support_hours}
                </div>
              </div>
            </div>
          </div>

          {/* Bottom regulatory & copyright notice */}
          <div className="pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-slate-500">
            <div>
              © {new Date().getFullYear()} MySewa Pvt. Ltd. · Kathmandu, Nepal · All Rights Reserved.
            </div>
            <div className="flex items-center gap-4">
              <span>NRB Regulated</span>
              <span>•</span>
              <span>ISO 27001 Certified</span>
              <span>•</span>
              <span>256-Bit SSL</span>
            </div>
          </div>
        </div>
      </footer>

      {/* 11. QUICK SIGN IN MODAL / DIALOG */}
      <Dialog open={loginModalOpen} onOpenChange={setLoginModalOpen}>
        <DialogContent className="max-w-md bg-[#0f172a] border border-white/15 text-slate-100 p-6 sm:p-8 rounded-2xl shadow-2xl">
          <DialogTitle className="sr-only">Sign In to MySewa</DialogTitle>
          <LoginView compact onSuccess={() => setLoginModalOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
