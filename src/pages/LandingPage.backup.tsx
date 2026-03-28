import React, { useRef } from "react";
import { Button } from "@/components/ui/button";
import { CommunityButtons } from "@/components/community/CommunityButtons";
import logo from "@/assets/logo.jpg";
import {
  CheckCircle2,
  Wallet,
  Activity,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, useInView } from "framer-motion";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import MarcusPoints from "@/components/MarcusPoints";

/* ------------------ ANIMATION WRAPPER ------------------ */

const AnimatedSection: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { amount: 0.3 });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7 }}
    >
      {children}
    </motion.div>
  );
};

/* ------------------ COMPONENT ------------------ */

const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const referralCode = searchParams.get('ref');
  const signUpPath = referralCode
    ? `/login?mode=signup&ref=${encodeURIComponent(referralCode)}`
    : '/login?mode=signup';

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden relative scroll-smooth">

      {/* NAVBAR */}
      <header className="sticky top-0 z-50 backdrop-blur bg-black/70 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">

          <div
            className="flex items-center gap-3 cursor-pointer"
            onClick={() => navigate("/")}
          >
            <img
              src={logo}
              alt="logo"
              className="h-10 w-10 rounded-full ring-1 ring-purple-500/40 shadow-[0_0_20px_rgba(168,85,247,0.4)]"
            />
          </div>

          <div className="hidden md:flex items-center gap-8 text-sm text-gray-300">
            <a href="#how-it-works" className="hover:text-purple-400 transition">
              Features
            </a>
            <a href="#how-it-works" className="hover:text-purple-400 transition">
              How It Works
            </a>
            <a href="#faq" className="hover:text-purple-400 transition">
              FAQ
            </a>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" className="border-white/20 text-purple-400" onClick={() => navigate("/login")}>
              Log in
            </Button>
            <Button className="bg-purple-600 shadow-[0_0_30px_rgba(168,85,247,0.6)]" onClick={() => navigate(signUpPath)}>
              Sign Up
            </Button>
          </div>

        </div>
      </header>

      {/* HERO */}
      <section className="relative min-h-[90vh] flex items-center justify-center text-center">

        {/* ARC */}
        {/* <svg className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[900px] opacity-30" viewBox="0 0 900 450">
          <defs>
            <path id="arcPath" d="M 100 400 A 350 350 0 0 1 800 400" />
          </defs>
          <use href="#arcPath" fill="none" stroke="rgba(168,85,247,0.3)" strokeWidth="2" />
          <circle r="6" fill="#a855f7">
            <animateMotion dur="25s" repeatCount="indefinite">
              <mpath href="#arcPath" />
            </animateMotion>
          </circle>
        </svg> */}

        <div className="absolute inset-0 opacity-60">
          <MarcusPoints size="compact" />
        </div>

        <div className="relative z-10 max-w-5xl px-6">
          <h1 className="text-[clamp(2.5rem,6vw,4.5rem)] font-bold">
            Welcome To
            <span className="block text-purple-400 drop-shadow-[0_0_30px_rgba(168,85,247,0.6)]">
              STOIC OPS
            </span>
          </h1>

          <p className="mt-6 text-gray-400 max-w-2xl mx-auto">
            A task operations & workflow platform for 
            <span className="text-purple-400"> distributed </span>contributors .
          </p>

          <p className="mt-3 text-sm text-gray-500 max-w-2xl mx-auto">
            Need help? Contact support at{" "}
            <a
              href="mailto:care@stoic-ops.com"
              className="text-purple-400 hover:text-purple-300 transition-colors"
            >
              care@stoic-ops.com
            </a>
            .
          </p>

          <div className="mt-6 flex flex-col items-center gap-3 text-sm text-gray-300">
            <p className="max-w-2xl">
              Join our Discord and Telegram communities for easier access, updates, and support.
            </p>
            <CommunityButtons className="justify-center" />
          </div>

          <Button className="mt-8 bg-purple-600 shadow-[0_0_35px_rgba(168,85,247,0.7)]" onClick={() => navigate(signUpPath)}>
            Get Started →
          </Button>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="relative py-40 bg-black overflow-visible">

        {/* MASSIVE RADIATION */}
        <div className="absolute inset-0 flex justify-center items-center pointer-events-none">
          <div className="absolute w-[500px] h-[500px] bg-purple-600 rounded-full blur-[100px] opacity-45" />
          <div className="absolute w-[800px] h-[800px] bg-purple-500 rounded-full blur-[160px] opacity-50" />
          <div className="absolute w-[1200px] h-[1200px] bg-purple-500 rounded-full blur-[220px] opacity-10" />
        </div>

        {/* BIG ORBIT CIRCLE + DOT */}
        <div className="absolute inset-x-0 top-28 bottom-0 flex items-center justify-center pointer-events-none z-0 md:top-24">
          <svg
            className="absolute w-[min(90vw,900px)] h-[min(90vw,900px)] opacity-20"
            viewBox="0 0 900 900"
            aria-hidden="true"
          >
            <defs>
              <filter id="orbitGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>

              <filter id="orbitGlowSoft" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="1.6" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>

              <filter id="orbitGlowStrong" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3.6" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <circle
              cx="450"
              cy="450"
              r="320"
              fill="none"
              stroke="white"
              strokeOpacity="0.25"
              strokeWidth="2"
            />

            <circle
              cx="450"
              cy="450"
              r="240"
              fill="none"
              stroke="white"
              strokeOpacity="0.22"
              strokeWidth="2"
              filter="url(#orbitGlowSoft)"
            />

            <circle
              cx="450"
              cy="450"
              r="160"
              fill="none"
              stroke="white"
              strokeOpacity="0.28"
              strokeWidth="2"
              filter="url(#orbitGlowStrong)"
            />

            {/* Dots orbiting each circle */}
            <g>
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="0 450 450"
                to="360 450 450"
                dur="30s"
                repeatCount="indefinite"
              />
              <circle cx="450" cy="130" r="8" fill="#a855f7" opacity="0.9" filter="url(#orbitGlow)" />
            </g>

            <g>
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="0 450 450"
                to="-360 450 450"
                dur="22s"
                repeatCount="indefinite"
              />
              <circle cx="450" cy="210" r="7" fill="#a855f7" opacity="0.75" filter="url(#orbitGlow)" />
            </g>

            <g>
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="0 450 450"
                to="360 450 450"
                dur="16s"
                repeatCount="indefinite"
              />
              <circle cx="450" cy="290" r="6" fill="#a855f7" opacity="0.6" filter="url(#orbitGlow)" />
            </g>
          </svg>
        </div>

        <AnimatedSection>
          <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-12 px-6 relative z-10">

            <div className="bg-[#111117] border border-purple-500/20 p-8 text-center rounded-2xl transition-transform duration-300 ease-out hover:scale-105">
              <CheckCircle2 className="mx-auto text-purple-400" size={36} />
              <h4 className="mt-4 font-semibold">Sign Up & Get Approved</h4>
            </div>

            <div className="bg-[#111117] border border-purple-500/20 p-8 text-center rounded-2xl transition-transform duration-300 ease-out hover:scale-105">
              <Activity className="mx-auto text-purple-400" size={36} />
              <h4 className="mt-4 font-semibold">
                Complete Verified Tasks
              </h4>
            </div>

            <div className="bg-[#111117] border border-purple-500/20 p-8 text-center rounded-2xl transition-transform duration-300 ease-out hover:scale-105">
              <Wallet className="mx-auto text-purple-400" size={36} />
              <h4 className="mt-4 font-semibold">Withdraw Securely</h4>
            </div>

          </div>
        </AnimatedSection>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-32 bg-black">
        <AnimatedSection>
          <div className="max-w-3xl mx-auto text-center mb-12 px-6">
            <h2 className="text-3xl font-bold">Frequently Asked Questions</h2>
          </div>

          <Accordion type="single" collapsible className="space-y-4 max-w-3xl mx-auto px-6">
            <AccordionItem value="1">
              <AccordionTrigger className="no-underline hover:no-underline focus:no-underline [&[data-state=open]]:no-underline">How much can I earn?</AccordionTrigger>
              <AccordionContent>
                Earnings depends on task complexity and activity and your Reddit account's reputation.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="2">
              <AccordionTrigger className="no-underline hover:no-underline focus:no-underline [&[data-state=open]]:no-underline">When do I get paid?</AccordionTrigger>
              <AccordionContent>
                Funds are processed after task verification.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="3">
              <AccordionTrigger className="no-underline hover:no-underline focus:no-underline [&[data-state=open]]:no-underline">Is STOIC OPS free to join?</AccordionTrigger>
              <AccordionContent>
                Yes. Stoic OPS is completely free to join. There are no hidden fees or charges for using our platform.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="4">
              <AccordionTrigger className="no-underline hover:no-underline focus:no-underline [&[data-state=open]]:no-underline">What kind of Reddit account do I need?</AccordionTrigger>
              <AccordionContent>
                You need an active Reddit account with basic credibility. This typically means having a Reddit account that is at least a few weeks old, has some post or comment history, and is in good standing with Reddit's community guidelines. Accounts that are brand new or have no activity may not be eligible to participate in tasks on our platform.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="5">
              <AccordionTrigger className="no-underline hover:no-underline focus:no-underline [&[data-state=open]]:no-underline">What happens if I can't complete a task?</AccordionTrigger>
              <AccordionContent>
                You can release the task before deadline in most cases or if you failed to complete accepted tasks it will be released for other users to work on.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="6">
              <AccordionTrigger className="no-underline hover:no-underline focus:no-underline [&[data-state=open]]:no-underline">Is posting on Reddit safe?</AccordionTrigger>
              <AccordionContent>
                Yes, as long as you follow Reddit's community guidelines. Our tasks are designed to be compliant with Reddit's rules, and we encourage all users to adhere to Reddit's policies when completing tasks. Always ensure that your Reddit account is in good standing and avoid any activities that could be considered spammy or violate Reddit's terms of service.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </AnimatedSection>
      </section>

      <footer className="py-10 text-center text-gray-500 border-t border-white/5 bg-black">
        © {new Date().getFullYear()} StoicOPS. All rights reserved.
      </footer>

    </div>
  );
};

export default LandingPage;
