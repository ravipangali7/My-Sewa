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
  ShieldCheck,
  QrCode,
  Download,
  CheckCircle2,
  ExternalLink,
  Send,
  Receipt,
  UserCheck,
  MapPin,
  PhoneCall,
  Mail,
  Lock,
  ArrowRight,
  Sparkles,
  Fingerprint,
  Building2,
  Clock,
  Check,
  Copy,
} from "lucide-react";
import type { LandingPageConfig } from "@/lib/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MySewa — Nepal's Premier Sovereign Digital Wallet & Payment Platform" },
      {
        name: "description",
        content:
          "MySewa is Nepal's trusted sovereign digital wallet: instant NTC/Ncell top-up, NEA electricity, Khanepani water, fiber internet, 24/7 bank transfers via NCHL-IPS rails, and global remittance.",
      },
      { property: "og:title", content: "MySewa — Nepal's Premier Sovereign Digital Wallet & Payment Platform" },
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
  hero_title: "Nepal’s Premier Sovereign Digital Wallet & Payment Platform",
  hero_subtitle:
    "Seamlessly pay utility bills, transfer to 30+ commercial banks via NCHL-IPS in seconds, send inward international remittance, and scan NepalPay QR anywhere across Nepal.",
  hero_cta_primary_text: "Download MySewa App",
  hero_cta_primary_url: "#download-app",
  hero_cta_secondary_text: "Explore Services",
  hero_cta_secondary_url: "#services",
  announcement_enabled: true,
  announcement_text: "⚡ 2% Instant Cashback on NTC & Ncell Mobile Recharges this month! ⚡",
  announcement_link: "#services",
  stat_1_value: "4.8M+",
  stat_1_label: "Active Verified Citizens",
  stat_1_sub: "Active users across all 77 districts",
  stat_2_value: "रू 182B+",
  stat_2_label: "Annual Settlement Vol",
  stat_2_sub: "Settled over NCHL connectIPS rails",
  stat_3_value: "99.98%",
  stat_3_label: "Payment Rail Uptime",
  stat_3_sub: "Tier-4 Sovereign Local Datacenter",
  stat_4_value: "< 1.2s",
  stat_4_label: "Avg Transaction Finality",
  stat_4_sub: "Sub-second instant payment ACK",
  app_title: "Carry Nepal's Digital Economy in Your Pocket",
  app_subtitle:
    "Download the official MySewa app on Android or iOS. Instant biometric logins, offline NepalPay QR generation, and real-time transaction receipts.",
  play_store_url: "https://play.google.com/store/apps/details?id=com.mysewa.wallet",
  app_store_url: "https://apps.apple.com/app/mysewa-nepal/id123456789",
  direct_apk_url: "",
  support_hours: "24/7 Toll-Free & Helpdesk",
  toll_free_number: "1660-01-MYSEWA",
  office_location: "Hattisar, Ward 1, Kathmandu, Bagmati Province, Nepal",
  social_facebook: "https://facebook.com/mysewanepal",
  social_whatsapp: "https://wa.me/9779800000000",
  social_telegram: "https://t.me/mysewa_official",
  social_twitter: "https://twitter.com/mysewanepal",
  show_testimonials: true,
  show_faqs: true,
  faqs: [
    {
      question: "How fast is the instant Nagarikta KYC verification?",
      answer:
        "Our biometric optical character recognition system cross-references national citizenship numbers directly with authorized central verification servers in real-time. Over 94% of users are verified in under 90 seconds without manual branch visits.",
    },
    {
      question: "Can I transfer money during Saturday or government public holidays?",
      answer:
        "Yes. MySewa operates 24/7/365 on the direct NCHL connectIPS instant interbank rails. Real-time gross settlement between member commercial banks occurs continuously regardless of weekends or state holidays.",
    },
    {
      question: "What are the transaction charges for utility bills and bank transfers?",
      answer:
        "All standard utility payments (Electricity NEA, Water Khanepani, ISP Fiber, Telecom recharges) are 100% free with eligible cashbacks. Bank transfers via connectIPS carry nominal tiered fees strictly regulated by Nepal Rastra Bank guidelines.",
    },
    {
      question: "Is inward international remittance deposited directly into the wallet?",
      answer:
        "Yes. When family members abroad send funds via our international money transfer partners from UAE, Qatar, US, UK, Australia, or Japan using your 10-digit mobile number, the NPR amount is credited directly to your MySewa wallet with instant SMS alert.",
    },
    {
      question: "How does MySewa protect my funds and personal data?",
      answer:
        "MySewa is regulated under the Nepal Rastra Bank Payment Systems Department, with bank-grade 256-bit TLS encryption, biometric FIDO2 device binding, and real-time AI AML fraud detection.",
    },
  ],
};

function HomePage() {
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [nepalTime, setNepalTime] = useState("");
  const [serviceCategory, setServiceCategory] = useState<"all" | "utilities" | "banking" | "telecom" | "gov">("all");
  const [smsPhone, setSmsPhone] = useState("");
  const [smsSent, setSmsSent] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

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

  const handleSendSms = (e: React.FormEvent) => {
    e.preventDefault();
    if (smsPhone.trim()) {
      setSmsSent(true);
      setTimeout(() => setSmsSent(false), 4000);
      setSmsPhone("");
    }
  };

  const handleCopyCode = () => {
    const codeSnippet = `// Initialize MySewa SDK via Kathmandu Gateway
const payment = await mysewa.checkout.create({
  amount: 450000, // NPR 4,500.00
  currency: "NPR",
  settlementRails: "NCHL_NEPALPAY_DIRECT",
  customer: {
    mobile: "+9779801234567",
    kycLevel: "TIER_3_BIOMETRIC"
  },
  metadata: {
    order_id: "ORD-KTM-2024-9182",
    tax_pan: "301294821"
  }
});`;
    navigator.clipboard?.writeText(codeSnippet);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2500);
  };

  // Flutter WebView native container: Render LoginView directly so app operates seamlessly
  if (isFlutterWebView()) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <LoginView />
      </div>
    );
  }

  const servicesList = [
    {
      id: "topup",
      category: "telecom" as const,
      title: "Mobile Top-Up & 5G Data",
      desc: "Instant prepaid and postpaid recharges for Nepal Telecom (Namaste), Ncell Axiata, and SmartCell.",
      tag: "Instant 2% Cashback",
      tagHighlight: true,
      meta: "0% Fee • Instant",
      action: "Recharge Now",
      icon: Smartphone,
      iconBg: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    {
      id: "electricity",
      category: "utilities" as const,
      title: "NEA Electricity & Water",
      desc: "Official clearing counter for Nepal Electricity Authority (NEA) and Kathmandu Valley Khanepani across 77 districts.",
      tag: "Real-time NEA Sync",
      tagHighlight: false,
      meta: "Smart Meter Sync",
      action: "Pay Counters",
      icon: Zap,
      iconBg: "bg-amber-50 text-amber-700 border-amber-200",
    },
    {
      id: "internet",
      category: "telecom" as const,
      title: "Fiber Internet Renewal",
      desc: "Renew WorldLink, Vianet, Subisu, ClassicTech, and DishHome with automatic immediate line reactivation.",
      tag: "Zero Gateway Surcharge",
      tagHighlight: true,
      meta: "Zero Downtime",
      action: "Renew ISP",
      icon: Wifi,
      iconBg: "bg-sky-50 text-sky-700 border-sky-200",
    },
    {
      id: "transfer",
      category: "banking" as const,
      title: "24/7 Interbank Transfer",
      desc: "Direct sovereign integration with Global IME, Nabil, NIC Asia, Everest, Standard Chartered, and Rastriya Banijya Bank.",
      tag: "connectIPS Protocol",
      tagHighlight: false,
      meta: "Instant Finality",
      action: "Send to Bank",
      icon: Landmark,
      iconBg: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    {
      id: "remittance",
      category: "banking" as const,
      title: "Inward Remittance",
      desc: "Receive remittances directly into your MySewa wallet with zero landing fees from Qatar, UAE, USA, Australia, and the UK.",
      tag: "Live FX Best Rate",
      tagHighlight: true,
      meta: "Direct Deposit",
      action: "Receive Remit",
      icon: Coins,
      iconBg: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    {
      id: "government",
      category: "gov" as const,
      title: "Government Tax & Traffic",
      desc: "Direct clearance for Nepal Police traffic challans, Inland Revenue Department (IRD), Lok Sewa Aayog, and passport fees.",
      tag: "Government Treasury",
      tagHighlight: false,
      meta: "Direct Govt Rail",
      action: "Pay Revenue",
      icon: FileText,
      iconBg: "bg-blue-50 text-blue-700 border-blue-200",
    },
    {
      id: "flights",
      category: "utilities" as const,
      title: "Domestic Flights & Buses",
      desc: "Buddha Air, Yeti Airlines, Shree Airlines, and long-route tourist deluxe bus ticketing with instant e-tickets.",
      tag: "Instant e-Ticket",
      tagHighlight: true,
      meta: "Best Fare Lock",
      action: "Book Travel",
      icon: Plane,
      iconBg: "bg-cyan-50 text-cyan-700 border-cyan-200",
    },
    {
      id: "insurance",
      category: "banking" as const,
      title: "Insurance & EMIs",
      desc: "Timely settlement for MetLife, Nepal Life, Shikhar Insurance, and commercial credit EMI installments with automated receipt.",
      tag: "Automated Standing Order",
      tagHighlight: false,
      meta: "Instant Receipt",
      action: "Pay Premium",
      icon: Shield,
      iconBg: "bg-purple-50 text-purple-700 border-purple-200",
    },
  ];

  const filteredServices = servicesList.filter((s) => {
    if (serviceCategory === "all") return true;
    return s.category === serviceCategory;
  });

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans antialiased selection:bg-emerald-100 selection:text-emerald-900 flex flex-col">
      {/* 1. TOP ANNOUNCEMENT NOTICE BAR (DYNAMIC) */}
      {landing.announcement_enabled && landing.announcement_text && (
        <aside
          aria-label="Announcement"
          className="bg-emerald-50 border-b border-emerald-200/80 py-2.5 px-4 text-center text-xs sm:text-sm font-medium text-emerald-900 flex items-center justify-center gap-2"
        >
          <span className="inline-block size-2 rounded-full bg-emerald-600 animate-pulse" />
          {landing.announcement_link ? (
            <a
              href={landing.announcement_link}
              className="hover:underline flex items-center gap-1.5 transition-colors font-semibold"
            >
              <span>{landing.announcement_text}</span>
              <ExternalLink className="size-3.5 opacity-80" />
            </a>
          ) : (
            <span className="font-semibold">{landing.announcement_text}</span>
          )}
        </aside>
      )}

      {/* 2. TOP NAVIGATION BAR */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-[0_1px_2px_0_rgba(15,23,42,0.04)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between">
          {/* Brand Logo & Telemetry */}
          <div className="flex items-center gap-4 sm:gap-6">
            <Link to="/" className="flex items-center gap-3 group">
              <div className="size-10 rounded-xl bg-slate-50 border border-slate-200 p-1.5 flex items-center justify-center shadow-xs group-hover:border-emerald-600 transition-colors">
                <img src={logoUrl} alt="MySewa" className="size-full object-contain rounded-lg" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-xl font-bold tracking-tight text-slate-900 group-hover:text-emerald-700 transition-colors">
                    MySewa
                  </span>
                  <span className="size-1.5 rounded-full bg-emerald-600" />
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 uppercase">
                    NP
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 tracking-wider uppercase font-medium hidden sm:inline-block">
                  Sovereign Digital Pay
                </span>
              </div>
            </Link>

            {/* Nepal Standard Time Telemetry Pill */}
            <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-full bg-slate-50 border border-slate-200 text-xs font-mono text-slate-600">
              <span className="size-2 rounded-full bg-emerald-600 animate-pulse" />
              <span className="text-slate-500 font-sans">NPT GMT+5:45</span>
              <span className="text-emerald-700 font-bold pl-1 tabular-nums">{nepalTime || "14:32:00"}</span>
            </div>
          </div>

          {/* Navigation Anchors */}
          <nav className="hidden md:flex items-center gap-6 lg:gap-8 text-sm font-semibold text-slate-600">
            <a href="#services" className="hover:text-emerald-700 transition-colors">
              Services
            </a>
            <a href="#how-it-works" className="hover:text-emerald-700 transition-colors">
              How It Works
            </a>
            <a href="#security" className="hover:text-emerald-700 transition-colors">
              Security & NRB
            </a>
            <a href="#download-app" className="hover:text-emerald-700 transition-colors">
              Mobile App
            </a>
            <a href="#faq" className="hover:text-emerald-700 transition-colors">
              FAQ
            </a>
          </nav>

          {/* Action CTAs */}
          <div className="flex items-center gap-3">
            {token && user ? (
              <button
                type="button"
                onClick={() => navigate({ to: homePathForUser(user) })}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm px-4 py-2 rounded-lg shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <UserCheck className="size-4" />
                <span>Go to Wallet</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setLoginModalOpen(true)}
                  className="px-3.5 py-2 rounded-lg text-sm font-semibold text-slate-700 hover:text-emerald-700 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Sign In
                </button>
                <Link
                  to="/register"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm px-4 py-2 rounded-lg shadow-xs active:scale-[0.98] transition-all flex items-center gap-1.5"
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
      <section className="relative pt-12 pb-20 md:pt-20 md:pb-28 overflow-hidden bg-gradient-to-b from-slate-50/80 via-white to-slate-50/30 border-b border-slate-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
            {/* Left Column: Copy & Rails Badges */}
            <div className="lg:col-span-7 flex flex-col items-start gap-6">
              {/* Regulatory Pill Chip */}
              <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold shadow-xs">
                <span className="size-2 rounded-full bg-emerald-600 animate-pulse" />
                <span className="font-semibold">{landing.hero_badge}</span>
              </div>

              {/* Main Headline */}
              <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.12] text-balance">
                {landing.hero_title}
              </h1>

              {/* Subheadline */}
              <p className="text-base sm:text-lg text-slate-600 max-w-2xl leading-relaxed font-normal">
                {landing.hero_subtitle}
              </p>

              {/* Dual Action Buttons */}
              <div className="flex flex-wrap items-center gap-4 pt-2 w-full sm:w-auto">
                <a
                  href={landing.hero_cta_primary_url}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-base font-semibold shadow-sm hover:shadow transition-all active:scale-[0.98]"
                >
                  <Download className="size-5" />
                  <span>{landing.hero_cta_primary_text}</span>
                </a>
                <a
                  href={landing.hero_cta_secondary_url}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-base font-semibold shadow-xs transition-all"
                >
                  <span>{landing.hero_cta_secondary_text}</span>
                  <ArrowRight className="size-4 text-slate-500" />
                </a>
              </div>

              {/* Connected Rails Institutional Proof */}
              <div className="pt-6 border-t border-slate-200 w-full">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  Institutional Infrastructure Rails
                </p>
                <div className="flex flex-wrap items-center gap-2.5 sm:gap-4 text-xs font-medium text-slate-700">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 shadow-xs">
                    <ShieldCheck className="size-4 text-emerald-600" /> connectIPS
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 shadow-xs">
                    <Smartphone className="size-4 text-emerald-600" /> Nepal Telecom
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 shadow-xs">
                    <Wifi className="size-4 text-emerald-600" /> Ncell Axiata
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 shadow-xs">
                    <Building2 className="size-4 text-emerald-600" /> 30+ Commercial Banks
                  </span>
                </div>
              </div>
            </div>

            {/* Right Column: High-Fidelity Clean White Fintech Preview Dashboard */}
            <div className="lg:col-span-5 relative">
              {/* Wallet Interface Card */}
              <div className="relative bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
                {/* Card Header: Profile & Status */}
                <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-sm">
                      SK
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-sm font-bold text-slate-900">Sujan Karki</h3>
                        <CheckCircle2 className="size-4 text-emerald-600 fill-emerald-100" />
                      </div>
                      <span className="text-xs text-slate-500 font-mono">+977 9841 •••• 92</span>
                    </div>
                  </div>
                  <div className="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-1">
                    <Fingerprint className="size-3.5 text-emerald-600" />
                    <span>KYC Tier 3</span>
                  </div>
                </div>

                {/* Balance Showcase */}
                <div className="p-6 bg-gradient-to-br from-white to-slate-50/60 border-b border-slate-100">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-medium mb-1.5">
                    <span>Available Digital Balance</span>
                    <span className="flex items-center gap-1 text-emerald-700 font-semibold">
                      <span className="size-1.5 rounded-full bg-emerald-600 animate-pulse" /> Instant NCHL
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2 mb-5">
                    <span className="text-sm font-bold text-slate-400">NPR</span>
                    <span className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight font-mono">
                      128,450.00
                    </span>
                  </div>

                  {/* Quick Action Buttons */}
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <button
                      type="button"
                      onClick={() => setLoginModalOpen(true)}
                      className="flex flex-col items-center gap-1.5 group cursor-pointer"
                    >
                      <div className="size-11 rounded-xl bg-emerald-600 text-white flex items-center justify-center group-hover:bg-emerald-700 transition-colors shadow-xs">
                        <Send className="size-5" />
                      </div>
                      <span className="text-xs text-slate-700 font-semibold">Send</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setLoginModalOpen(true)}
                      className="flex flex-col items-center gap-1.5 group cursor-pointer"
                    >
                      <div className="size-11 rounded-xl bg-white border border-slate-200 text-slate-700 flex items-center justify-center group-hover:bg-slate-50 transition-colors shadow-xs">
                        <Coins className="size-5" />
                      </div>
                      <span className="text-xs text-slate-700 font-semibold">Load</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setLoginModalOpen(true)}
                      className="flex flex-col items-center gap-1.5 group cursor-pointer"
                    >
                      <div className="size-11 rounded-xl bg-white border border-slate-200 text-slate-700 flex items-center justify-center group-hover:bg-slate-50 transition-colors shadow-xs">
                        <Receipt className="size-5" />
                      </div>
                      <span className="text-xs text-slate-700 font-semibold">Pay Bills</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setLoginModalOpen(true)}
                      className="flex flex-col items-center gap-1.5 group cursor-pointer"
                    >
                      <div className="size-11 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center group-hover:bg-emerald-200 transition-colors shadow-xs">
                        <QrCode className="size-5" />
                      </div>
                      <span className="text-xs text-slate-700 font-semibold">NepalPay</span>
                    </button>
                  </div>
                </div>

                {/* Live Settlement Ledger Feed */}
                <div className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Real-Time Transactions
                    </span>
                    <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                      <Clock className="size-3.5" /> 1.2s ACK
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {/* Transaction 1 */}
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50/70 border border-slate-100">
                      <div className="flex items-center gap-3">
                        <div className="size-8 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
                          <Zap className="size-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-slate-900">NEA Electricity Kathmandu</div>
                          <div className="text-[11px] text-slate-500">Ratnapark Counter • Today 11:20 AM</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-bold text-slate-900 font-mono">- NPR 3,420.00</div>
                        <span className="text-[10px] text-emerald-700 font-semibold">Cleared</span>
                      </div>
                    </div>

                    {/* Transaction 2 */}
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50/70 border border-slate-100">
                      <div className="flex items-center gap-3">
                        <div className="size-8 rounded-lg bg-sky-50 text-sky-700 flex items-center justify-center">
                          <Wifi className="size-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-slate-900">NTC FTTH Fiber 100Mbps</div>
                          <div className="text-[11px] text-slate-500">Yearly Renewal • Yesterday</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-bold text-slate-900 font-mono">- NPR 1,550.00</div>
                        <span className="text-[10px] text-emerald-700 font-semibold">Cleared</span>
                      </div>
                    </div>

                    {/* Transaction 3 (Credit) */}
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-50/50 border border-emerald-100">
                      <div className="flex items-center gap-3">
                        <div className="size-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                          <Landmark className="size-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-slate-900">NCHL Transfer: Nabil Bank</div>
                          <div className="text-[11px] text-slate-500 font-mono">Ref #9811204</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-bold text-emerald-700 font-mono">+ NPR 25,000.00</div>
                        <span className="text-[10px] text-emerald-700 font-semibold">Settled 0.8s</span>
                      </div>
                    </div>
                  </div>

                  {/* Security Watermark Footer */}
                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Lock className="size-3.5 text-emerald-600" /> 256-Bit TLS Bank Encryption
                    </span>
                    <span className="font-medium">NRB Directive Compliant</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. TRUST & SETTLEMENT STATS STRIP (DYNAMIC) */}
      <section className="bg-white border-b border-slate-200 py-10 sm:py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 lg:gap-8">
            <div className="space-y-1">
              <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-mono tracking-tight">
                {landing.stat_1_value}
              </div>
              <div className="text-sm font-bold text-slate-800">{landing.stat_1_label}</div>
              <div className="text-xs text-slate-500">{landing.stat_1_sub}</div>
            </div>

            <div className="space-y-1">
              <div className="text-2xl sm:text-3xl font-extrabold text-emerald-700 font-mono tracking-tight">
                {landing.stat_2_value}
              </div>
              <div className="text-sm font-bold text-slate-800">{landing.stat_2_label}</div>
              <div className="text-xs text-slate-500">{landing.stat_2_sub}</div>
            </div>

            <div className="space-y-1">
              <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-mono tracking-tight">
                {landing.stat_3_value}
              </div>
              <div className="text-sm font-bold text-slate-800">{landing.stat_3_label}</div>
              <div className="text-xs text-slate-500">{landing.stat_3_sub}</div>
            </div>

            <div className="space-y-1">
              <div className="text-2xl sm:text-3xl font-extrabold text-emerald-700 font-mono tracking-tight">
                {landing.stat_4_value}
              </div>
              <div className="text-sm font-bold text-slate-800">{landing.stat_4_label}</div>
              <div className="text-xs text-slate-500">{landing.stat_4_sub}</div>
            </div>
          </div>
        </div>
      </section>

      {/* 5. ORGANIZED SERVICES & PAYMENT RAILS GRID */}
      <section className="py-20 bg-slate-50/60 border-b border-slate-200" id="services">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Section Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
            <div>
              <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
                Payment Rails & Ecosystem
              </span>
              <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 mt-1 tracking-tight">
                One wallet for all sovereign and retail transactions
              </h2>
              <p className="text-base text-slate-600 mt-2 max-w-2xl">
                Connect directly to government revenues, telecom infrastructure, international remittance houses, and
                every commercial banking node in Nepal.
              </p>
            </div>

            {/* Filter Segmented Tabs */}
            <div className="inline-flex p-1 rounded-xl bg-slate-200/70 border border-slate-300/60 text-xs font-semibold self-start md:self-auto">
              <button
                type="button"
                onClick={() => setServiceCategory("all")}
                className={`px-3.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                  serviceCategory === "all"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                All Services
              </button>
              <button
                type="button"
                onClick={() => setServiceCategory("utilities")}
                className={`px-3.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                  serviceCategory === "utilities"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Utilities
              </button>
              <button
                type="button"
                onClick={() => setServiceCategory("banking")}
                className={`px-3.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                  serviceCategory === "banking"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Banking & Remit
              </button>
              <button
                type="button"
                onClick={() => setServiceCategory("telecom")}
                className={`px-3.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                  serviceCategory === "telecom"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Telecom
              </button>
              <button
                type="button"
                onClick={() => setServiceCategory("gov")}
                className={`px-3.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                  serviceCategory === "gov"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Government
              </button>
            </div>
          </div>

          {/* 8-Card Service Bento Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {filteredServices.map((service) => {
              const IconComp = service.icon;
              return (
                <div
                  key={service.id}
                  className="p-6 rounded-2xl border border-slate-200 bg-white hover:border-emerald-500/60 transition-all shadow-xs hover:shadow-md flex flex-col justify-between group"
                >
                  <div>
                    <div
                      className={`size-12 rounded-xl flex items-center justify-center border mb-4 group-hover:scale-105 transition-transform ${service.iconBg}`}
                    >
                      <IconComp className="size-6" />
                    </div>
                    <div className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 mb-2">
                      {service.tag}
                    </div>
                    <h3 className="text-base font-bold text-slate-900 mb-1.5 group-hover:text-emerald-700 transition-colors">
                      {service.title}
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed">{service.desc}</p>
                  </div>
                  <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-emerald-700">
                    <button
                      type="button"
                      onClick={() => setLoginModalOpen(true)}
                      className="inline-flex items-center gap-1 hover:underline cursor-pointer"
                    >
                      <span>{service.action}</span>
                      <ArrowRight className="size-3.5 group-hover:translate-x-0.5 transition-transform" />
                    </button>
                    <span className="text-[10px] text-slate-400 font-normal">{service.meta}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 6. FRICTIONLESS 3-STEP ONBOARDING */}
      <section className="py-20 bg-white border-b border-slate-200" id="how-it-works">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Fast-Track Verification</span>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 mt-1 tracking-tight">
              Get started in under 3 minutes
            </h2>
            <p className="text-base text-slate-600 mt-2">
              Zero paperwork friction. Fully integrated with the Ministry of Home Affairs National ID and Nagarikta database.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Step 1 */}
            <div className="bg-slate-50/60 rounded-2xl p-8 border border-slate-200 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="text-4xl font-extrabold text-slate-300 font-mono leading-none mb-4">01</div>
                <div className="size-11 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center mb-5">
                  <Fingerprint className="size-5" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">Instant Nagarikta KYC</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Snap your Citizenship or Rastriya Parichayapatra (NID). Our biometric OCR validates your credentials
                  within 90 seconds.
                </p>
              </div>
              <div className="mt-6 inline-flex items-center gap-1.5 text-xs text-emerald-700 font-bold">
                <CheckCircle2 className="size-4" />
                <span>NRB Tier-3 Approved</span>
              </div>
            </div>

            {/* Step 2 */}
            <div className="bg-slate-50/60 rounded-2xl p-8 border border-slate-200 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="text-4xl font-extrabold text-slate-300 font-mono leading-none mb-4">02</div>
                <div className="size-11 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center mb-5">
                  <Landmark className="size-5" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">Link & Load Seamlessly</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Link your bank account via connectIPS for instant zero-fee funding, or deposit cash at any of our
                  15,000+ verified partner points.
                </p>
              </div>
              <div className="mt-6 inline-flex items-center gap-1.5 text-xs text-emerald-700 font-bold">
                <Coins className="size-4" />
                <span>Zero Gateway Fees</span>
              </div>
            </div>

            {/* Step 3 */}
            <div className="bg-slate-50/60 rounded-2xl p-8 border border-slate-200 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="text-4xl font-extrabold text-slate-300 font-mono leading-none mb-4">03</div>
                <div className="size-11 rounded-xl bg-emerald-600 text-white flex items-center justify-center mb-5">
                  <QrCode className="size-5" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">Transact & Earn Rewards</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Scan over 250,000 NepalPay QR merchant stands nationwide, send funds to any mobile number, and
                  accumulate instant cashback rewards.
                </p>
              </div>
              <div className="mt-6 inline-flex items-center gap-1.5 text-xs text-emerald-700 font-bold">
                <Sparkles className="size-4" />
                <span>Up to 5% Cashback</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 7. BANK-GRADE SECURITY & DEVELOPER APIS */}
      <section className="py-20 bg-slate-50/60 border-b border-slate-200" id="security">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Left Column: Bank-Grade Security Controls */}
            <div className="lg:col-span-6 space-y-6">
              <div>
                <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Institutional Rigor</span>
                <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 mt-1 tracking-tight">
                  Bank-grade sovereign cryptography and regulatory compliance
                </h2>
                <p className="text-base text-slate-600 mt-2">
                  Regulated by Nepal Rastra Bank Payment Systems Department. Built according to international financial
                  clearing standards with sovereign datacenter redundancy.
                </p>
              </div>

              <div className="space-y-3.5 pt-2">
                <div className="flex items-start gap-4 p-4 rounded-xl border border-slate-200 bg-white shadow-xs">
                  <div className="size-10 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
                    <Fingerprint className="size-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">FIDO2 & Biometric Enclave</h4>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Private keys remain secured within device Hardware Security Modules (HSM). No passwords
                      transmitted across the wire.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4 p-4 rounded-xl border border-slate-200 bg-white shadow-xs">
                  <div className="size-10 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
                    <ShieldCheck className="size-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">Nepal Rastra Bank PSD Compliance</h4>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Strict ring-fenced escrow accounts maintained at commercial tier-1 partner banks under direct central
                      bank audit.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4 p-4 rounded-xl border border-slate-200 bg-white shadow-xs">
                  <div className="size-10 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
                    <Lock className="size-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">Real-Time AI AML Fraud Shield</h4>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Machine learning anomaly detection flags atypical velocities and protects senior citizens against
                      phishing attempts.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Developer API Sandbox Card */}
            <div className="lg:col-span-6">
              <div className="rounded-2xl border border-slate-800 bg-slate-900 text-slate-200 shadow-xl overflow-hidden">
                {/* Code Header */}
                <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="size-3 rounded-full bg-rose-500/80" />
                    <div className="size-3 rounded-full bg-amber-500/80" />
                    <div className="size-3 rounded-full bg-emerald-500/80" />
                    <span className="ml-2 text-xs font-mono text-slate-400">POST /v1/merchant/checkout</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-500/20 text-emerald-400 font-semibold border border-emerald-500/30">
                      200 OK
                    </span>
                    <span className="text-xs font-mono text-slate-400">42ms</span>
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="ml-2 text-slate-400 hover:text-white transition-colors cursor-pointer"
                      title="Copy code"
                    >
                      {copiedCode ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Code Body */}
                <div className="p-6 font-mono text-xs leading-relaxed overflow-x-auto text-slate-300">
                  <pre>
                    <code>
                      <span className="text-slate-500">// Initialize MySewa SDK via Kathmandu Gateway</span>
                      {"\n"}
                      <span className="text-emerald-400">const</span> payment ={" "}
                      <span className="text-emerald-400">await</span> mysewa.checkout.create(&#123;
                      {"\n"}  amount: <span className="text-amber-300">450000</span>,{" "}
                      <span className="text-slate-500">// NPR 4,500.00</span>
                      {"\n"}  currency: <span className="text-emerald-300">&quot;NPR&quot;</span>,
                      {"\n"}  settlementRails:{" "}
                      <span className="text-emerald-300">&quot;NCHL_NEPALPAY_DIRECT&quot;</span>,
                      {"\n"}  customer: &#123;
                      {"\n"}    mobile: <span className="text-emerald-300">&quot;+9779801234567&quot;</span>,
                      {"\n"}    kycLevel: <span className="text-emerald-300">&quot;TIER_3_BIOMETRIC&quot;</span>
                      {"\n"}  &#125;,
                      {"\n"}  metadata: &#123;
                      {"\n"}    order_id: <span className="text-emerald-300">&quot;ORD-KTM-2024-9182&quot;</span>,
                      {"\n"}    tax_pan: <span className="text-emerald-300">&quot;301294821&quot;</span>
                      {"\n"}  &#125;
                      {"\n"}&#125;);
                      {"\n\n"}
                      <span className="text-slate-500">// Immediate Webhook Response</span>
                      {"\n"}&#123;
                      {"\n"}  <span className="text-emerald-400">&quot;status&quot;</span>:{" "}
                      <span className="text-amber-300">&quot;cleared&quot;</span>,
                      {"\n"}  <span className="text-emerald-400">&quot;nchl_ack&quot;</span>:{" "}
                      <span className="text-emerald-300">&quot;ACK-77-NBL-892301&quot;</span>,
                      {"\n"}  <span className="text-emerald-400">&quot;settled_at&quot;</span>:{" "}
                      <span className="text-emerald-300">&quot;2024-11-14T08:12:04.102Z&quot;</span>
                      {"\n"}&#125;
                    </code>
                  </pre>
                </div>

                {/* Card Bottom Bar */}
                <div className="px-6 py-3.5 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between text-xs">
                  <span className="text-slate-400">SDKs for Node.js, Python, PHP, Java, Flutter & Go</span>
                  <a
                    href="#download-app"
                    className="text-emerald-400 hover:underline font-semibold flex items-center gap-1"
                  >
                    <span>Read API Docs</span>
                    <ExternalLink className="size-3.5" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 8. MOBILE APP QR DOWNLOAD BANNER (DYNAMIC) */}
      <section className="py-20 bg-white border-b border-slate-200" id="download-app">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-gradient-to-br from-emerald-50/40 via-white to-slate-50 border border-slate-200 rounded-3xl p-8 md:p-12 shadow-sm">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              {/* Text and Actions */}
              <div className="lg:col-span-8 space-y-5">
                <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
                  Available on iOS & Android
                </span>
                <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
                  {landing.app_title}
                </h2>
                <p className="text-base text-slate-600 max-w-xl leading-relaxed">{landing.app_subtitle}</p>

                {/* SMS download link input */}
                <form onSubmit={handleSendSms} className="pt-2 flex flex-col sm:flex-row gap-3 max-w-md">
                  <div className="relative flex-1">
                    <span className="absolute left-3.5 top-2.5 text-slate-500 text-sm font-semibold">+977</span>
                    <input
                      type="tel"
                      value={smsPhone}
                      onChange={(e) => setSmsPhone(e.target.value)}
                      placeholder="98XXXXXXXX"
                      className="w-full pl-16 pr-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-xs transition-colors cursor-pointer"
                  >
                    {smsSent ? "Link Sent!" : "Send App Link"}
                  </button>
                </form>

                {/* Official Store Buttons & Direct APK */}
                <div className="flex flex-wrap items-center gap-3 pt-3">
                  <a
                    href={landing.app_store_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 transition-colors shadow-xs"
                  >
                    <Smartphone className="size-5 text-slate-900" />
                    <div className="text-left">
                      <div className="text-[10px] text-slate-500 leading-none">Download on the</div>
                      <div className="text-xs font-bold text-slate-900">Apple App Store</div>
                    </div>
                  </a>

                  <a
                    href={landing.play_store_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 transition-colors shadow-xs"
                  >
                    <Smartphone className="size-5 text-emerald-600" />
                    <div className="text-left">
                      <div className="text-[10px] text-slate-500 leading-none">Get it on</div>
                      <div className="text-xs font-bold text-slate-900">Google Play Store</div>
                    </div>
                  </a>

                  {apkDownloadUrl && (
                    <a
                      href={apkDownloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 text-xs font-bold transition-colors shadow-xs"
                    >
                      <Download className="size-4" />
                      <span>Download Direct APK</span>
                    </a>
                  )}
                </div>
              </div>

              {/* QR Code Container */}
              <div className="lg:col-span-4 flex flex-col items-center justify-center p-6 rounded-2xl border border-slate-200 bg-white shadow-xs">
                <div className="size-44 bg-slate-50 rounded-2xl p-4 border border-slate-200 flex flex-col items-center justify-center text-center gap-2">
                  <QrCode className="size-20 text-emerald-700" />
                  <span className="text-[11px] font-bold text-emerald-800 font-mono tracking-wider">
                    SCAN NEPALPAY
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-3 text-center">Point phone camera to install directly</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 9. INTERACTIVE FAQ ACCORDION (DYNAMIC) */}
      {landing.show_faqs && (
        <section className="py-20 bg-slate-50/50 border-b border-slate-200" id="faq">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
                Transparent Knowledge
              </span>
              <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 mt-1 tracking-tight">
                Frequently asked questions
              </h2>
              <p className="text-base text-slate-600 mt-2">
                Everything you need to know about MySewa, limits, clearing rails, and central bank regulations.
              </p>
            </div>

            <Accordion type="single" collapsible className="space-y-3">
              {(landing.faqs || []).map((faq, index) => (
                <AccordionItem
                  key={index}
                  value={`faq-${index}`}
                  className="bg-white border border-slate-200 rounded-xl px-5 shadow-xs overflow-hidden"
                >
                  <AccordionTrigger className="text-sm sm:text-base font-bold text-slate-900 hover:text-emerald-700 hover:no-underline py-4">
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-xs sm:text-sm text-slate-600 leading-relaxed pb-4 pt-1">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>
      )}

      {/* 10. CORPORATE FOOTER (DYNAMIC) */}
      <footer className="bg-slate-900 text-slate-300 pt-16 pb-12 mt-auto" id="contact">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-10">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
            {/* Brand Info */}
            <div className="md:col-span-2 space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="size-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white">
                  <Smartphone className="size-4" />
                </div>
                <span className="text-xl font-bold text-white tracking-tight">MySewa</span>
              </div>
              <p className="text-xs sm:text-sm text-slate-400 max-w-sm leading-relaxed">
                Nepal’s sovereign payment service provider. Empowering digital financial inclusion across 77 districts
                through ultra-resilient banking rails and instant clearing.
              </p>
              <div className="text-xs text-slate-400 space-y-1 pt-1">
                <div className="flex items-center gap-2">
                  <MapPin className="size-3.5 text-emerald-400 shrink-0" />
                  <span>{landing.office_location}</span>
                </div>
                <div className="flex items-center gap-2">
                  <PhoneCall className="size-3.5 text-emerald-400 shrink-0" />
                  <span>Toll Free: {landing.toll_free_number} • {landing.support_hours}</span>
                </div>
              </div>
            </div>

            {/* Products */}
            <div className="space-y-3">
              <div className="text-sm font-bold text-white">Products</div>
              <ul className="space-y-2 text-xs text-slate-400">
                <li><a href="#services" className="hover:text-emerald-400 transition-colors">Mobile Wallet App</a></li>
                <li><a href="#services" className="hover:text-emerald-400 transition-colors">NepalPay QR Merchant Stand</a></li>
                <li><a href="#services" className="hover:text-emerald-400 transition-colors">connectIPS Interbank</a></li>
                <li><a href="#services" className="hover:text-emerald-400 transition-colors">Utility Billing Portal</a></li>
                <li><a href="#services" className="hover:text-emerald-400 transition-colors">Inward Remittance Hub</a></li>
              </ul>
            </div>

            {/* Regulatory */}
            <div className="space-y-3">
              <div className="text-sm font-bold text-white">Regulatory</div>
              <ul className="space-y-2 text-xs text-slate-400">
                <li><a href="#security" className="text-emerald-400 font-semibold hover:underline">NRB PSD Compliance</a></li>
                <li><a href="#security" className="hover:text-emerald-400 transition-colors">NCHL-IPS Integration</a></li>
                <li><a href="#security" className="hover:text-emerald-400 transition-colors">Security & Encryption</a></li>
                <li><Link to="/legal" className="hover:text-emerald-400 transition-colors">Privacy Policy</Link></li>
                <li><Link to="/legal" className="hover:text-emerald-400 transition-colors">Terms of Service</Link></li>
              </ul>
            </div>

            {/* Ecosystem & Customer Care */}
            <div className="space-y-3">
              <div className="text-sm font-bold text-white">Ecosystem</div>
              <ul className="space-y-2 text-xs text-slate-400">
                <li>
                  <button
                    type="button"
                    onClick={() => setLoginModalOpen(true)}
                    className="hover:text-emerald-400 text-left cursor-pointer"
                  >
                    Customer Sign In
                  </button>
                </li>
                <li><Link to="/register" className="hover:text-emerald-400 transition-colors">Open Personal Account</Link></li>
                <li><a href="#download-app" className="hover:text-emerald-400 transition-colors">Developer Portal</a></li>
                <li><a href="#download-app" className="hover:text-emerald-400 transition-colors">Merchant Settlements</a></li>
                {landing.social_whatsapp && (
                  <li>
                    <a
                      href={landing.social_whatsapp}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-emerald-400 transition-colors"
                    >
                      WhatsApp Helpdesk
                    </a>
                  </li>
                )}
              </ul>
            </div>
          </div>

          {/* Bottom Bar: Regulatory String */}
          <div className="pt-8 border-t border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4 text-center md:text-left">
            <p className="text-xs text-slate-500">
              © {new Date().getFullYear()} MySewa Nepal Ltd. Authorized and Regulated as Payment Service Provider by Nepal
              Rastra Bank (NRB). Member of NCHL-IPS Network. All rights reserved.
            </p>
            <div className="flex items-center gap-2.5 shrink-0">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 text-[11px] font-semibold text-emerald-400 border border-slate-700">
                <span className="size-1.5 rounded-full bg-emerald-400" /> NRB PSD Validated
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 text-[11px] font-semibold text-slate-300 border border-slate-700">
                ISO 27001
              </span>
            </div>
          </div>
        </div>
      </footer>

      {/* 11. QUICK SIGN IN MODAL DIALOG */}
      <Dialog open={loginModalOpen} onOpenChange={setLoginModalOpen}>
        <DialogContent className="max-w-md p-0 overflow-hidden border-slate-200 bg-white">
          <DialogTitle className="sr-only">Sign In to MySewa</DialogTitle>
          <div className="p-6">
            <LoginView onSuccess={() => setLoginModalOpen(false)} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
