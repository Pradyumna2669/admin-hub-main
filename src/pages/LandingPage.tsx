import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useScroll, useTransform, useInView, animate, AnimatePresence } from 'framer-motion';
import { SiReddit } from 'react-icons/si';
import { CheckCircle2, Star, ChevronDown } from 'lucide-react';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { useAuth } from '@/contexts/AuthContext';

/* --- Interactive Components --- */

const MagneticButton = ({ children, className, onClick }: any) => {
  const ref = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const handleMouse = (e: React.MouseEvent<HTMLButtonElement>) => {
    const { clientX, clientY } = e;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const { height, width, left, top } = rect;
    const middleX = clientX - (left + width / 2);
    const middleY = clientY - (top + height / 2);
    setPosition({ x: middleX * 0.25, y: middleY * 0.25 });
  };

  const reset = () => setPosition({ x: 0, y: 0 });

  return (
    <motion.button
      ref={ref}
      onMouseMove={handleMouse}
      onMouseLeave={reset}
      animate={{ x: position.x, y: position.y }}
      transition={{ type: "spring", stiffness: 150, damping: 15, mass: 0.1 }}
      className={className}
      onClick={onClick}
    >
      {children}
    </motion.button>
  );
};

const AnimatedCounter = ({ from = 0, to }: { from?: number; to: number }) => {
  const nodeRef = useRef<HTMLSpanElement>(null);
  const inView = useInView(nodeRef, { once: true, margin: "-100px" });

  useEffect(() => {
    if (inView && nodeRef.current) {
      const controls = animate(from, to, {
        duration: 2.5,
        ease: "easeOut",
        onUpdate: (latest) => {
          if (nodeRef.current) {
            nodeRef.current.textContent = Math.round(latest).toLocaleString();
          }
        }
      });
      return () => controls.stop();
    }
  }, [inView, from, to]);

  return <span ref={nodeRef}>{from}</span>;
};


/* --- Display Components --- */

const AnimatedAuroraStreak = () => {
  return (
    <div className="absolute -bottom-[20%] left-[-10%] w-[120%] h-[120px] pointer-events-none overflow-hidden z-0 rotate-[-5deg]">
      <motion.div 
        animate={{ 
          x: ['-20%', '20%', '-20%'],
        }}
        transition={{ 
          duration: 15, 
          ease: "easeInOut", 
          repeat: Infinity 
        }}
        className="absolute inset-0 w-[200%] h-full opacity-60 dark:opacity-80 blur-[60px]"
        style={{
          background: 'linear-gradient(90deg, rgba(88,28,135,1) 0%, rgba(147,51,234,1) 20%, rgba(192,38,211,1) 40%, rgba(216,180,254,1) 60%, rgba(147,51,234,1) 80%, rgba(88,28,135,1) 100%)',
          backgroundSize: '200% auto',
        }}
      />
    </div>
  );
};

const FloatingRedditCard = ({ username, amount, time, delay, className }: any) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay, duration: 0.8 }}
      whileHover={{ y: -5, scale: 1.02 }}
      className={`absolute flex-col bg-white/70 dark:bg-[#131722]/80 backdrop-blur-xl border border-slate-200 dark:border-white/10 p-4 rounded-xl shadow-xl dark:shadow-2xl z-20 cursor-default ${className}`}
    >
      <div className="flex items-center gap-3 mb-3 relative z-10">
        <div className="bg-[#ff4500] p-1.5 rounded-full shadow-[0_0_15px_rgba(255,69,0,0.5)]">
          <SiReddit className="text-white w-4 h-4" />
        </div>
        <div>
          <div className="text-sm font-bold text-slate-800 dark:text-slate-200">{username}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Initial Post</div>
        </div>
      </div>
      <div className="flex items-center gap-2 bg-purple-500/10 border border-purple-500/20 px-3 py-2 rounded-lg relative z-10">
        <CheckCircle2 className="text-purple-500 dark:text-purple-400 w-4 h-4" />
        <div>
          <div className="text-sm font-bold text-purple-600 dark:text-purple-400">₹{amount} Paid</div>
          <div className="text-[10px] text-purple-600/70 dark:text-purple-400/70">{time}</div>
        </div>
      </div>
    </motion.div>
  );
};

// FAQ Accordion Card Component
const FAQCard = ({ question, answer }: { question: string, answer: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <motion.div 
      initial={false}
      onClick={() => setIsOpen(!isOpen)}
      className="bg-white dark:bg-[#131722]/50 border border-slate-200 dark:border-white/5 hover:border-purple-500/30 rounded-2xl cursor-pointer glow-card overflow-hidden"
    >
      <div className="p-6 relative z-10 flex justify-between items-center group">
        <h3 className="text-sm md:text-base font-bold text-slate-800 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
          {question}
        </h3>
        <motion.div animate={{ rotate: isOpen ? 180 : 0 }} className="text-slate-400 dark:text-slate-500">
          <ChevronDown className="w-5 h-5" />
        </motion.div>
      </div>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-6 pb-6 relative z-10"
          >
            <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed border-t border-slate-100 dark:border-white/5 pt-4">
              {answer}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, userRole, loading } = useAuth();
  const { scrollY } = useScroll();
  const yHeroText = useTransform(scrollY, [0, 800], [0, 200]);

  useEffect(() => {
    if (!loading && user && userRole) {
      if (userRole === 'admin' || userRole === 'owner') {
        navigate('/admin', { replace: true });
      } else if (userRole === 'moderator') {
        navigate('/admin/tasks', { replace: true });
      } else if (userRole === 'worker') {
        navigate('/worker', { replace: true });
      } else {
        navigate('/dashboard', { replace: true });
      }
    }
  }, [user, userRole, loading, navigate]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const cards = document.querySelectorAll('.glow-card');
    cards.forEach((card) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      (card as HTMLElement).style.setProperty("--mouse-x", `${x}px`);
      (card as HTMLElement).style.setProperty("--mouse-y", `${y}px`);
    });
  };

  const faqs = [
    {
      q: "How much can I earn?",
      a: "Earnings scale based on task complexity, timing, and your account's accumulated karma tier. Active members on StoicOPS typically average between ₹300 to ₹1,500 daily depending on their engagement strategy."
    },
    {
      q: "When do I get paid?",
      a: "Payouts are verified and processed instantly via our algorithmic ledger. Once a task is successfully audited, you can withdraw your balance directly to your designated local wallet or bank structure immediately."
    },
    {
      q: "Is STOIC OPS free to join?",
      a: "Yes. Joining STOIC OPS requires zero capital. We will never ask for upfront deposits, subscription fees, or credit cards."
    },
    {
      q: "What kind of Reddit account do I need?",
      a: "To qualify for entry-level operations, your Reddit account should possess a minimum baseline of 50 karma and at least 30 days of standard account history to pass our bot-detection filters."
    },
    {
      q: "What happens if I can't complete a task?",
      a: "No penalty applies. If an assigned task times out or you manually cancel it, it simply recycles back into the global pool for another user. Your core reputation metric remains unaffected."
    },
    {
      q: "Is posting on Reddit safe?",
      a: "Absolutely. Our tasks strictly align with organic community engagement protocols. However, it is always recommended to read the specific instructions to ensure your content fits seamlessly within the target subreddit's rules."
    }
  ];

  return (
    <div 
      className="font-sans bg-slate-50 dark:bg-[#090b14] text-slate-900 dark:text-[#dce1fb] overflow-x-hidden min-h-screen selection:bg-purple-500/30 transition-colors duration-300 relative"
      onMouseMove={handleMouseMove}
    >
      <style>{`
        .font-label { font-family: 'Space Grotesk', sans-serif; }
        .noise-bg {
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background-image: url('data:image/svg+xml;utf8,%3Csvg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"%3E%3Cfilter id="noiseFilter"%3E%3CfeTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch"/%3E%3C/filter%3E%3Crect width="100%25" height="100%25" filter="url(%23noiseFilter)" opacity="0.04"/%3E%3C/svg%3E');
            pointer-events: none;
            z-index: 50;
        }

        .glow-card { position: relative; }
        .glow-card::before, .glow-card::after {
            content: "";
            position: absolute;
            border-radius: inherit;
            opacity: 0;
            transition: opacity 500ms ease;
            pointer-events: none;
        }
        .glow-card::before {
            inset: 0;
            background: radial-gradient(600px circle at var(--mouse-x, -9999px) var(--mouse-y, -9999px), rgba(168, 85, 247, 0.08), transparent 40%);
            z-index: 0;
        }
        .glow-card::after {
            inset: -1px;
            background: radial-gradient(400px circle at var(--mouse-x, -9999px) var(--mouse-y, -9999px), rgba(168, 85, 247, 0.6), transparent 40%);
            z-index: -1;
        }
        .glow-card:hover::before, .glow-card:hover::after { opacity: 1; }

        @keyframes marquee {
            0% { transform: translateX(0); }
            100% { transform: translateX(-50%); }
        }
        .animate-marquee {
            display: flex;
            width: max-content;
            animation: marquee 40s linear infinite;
        }
        .animate-marquee:hover {
            animation-play-state: paused;
        }
      `}</style>

      {/* Subtle Grain Overlay */}
      <div className="noise-bg hidden dark:block"></div>
      
      {/* TopNavBar */}
      <nav className="fixed top-0 inset-x-0 w-full bg-white/50 dark:bg-[#090b14]/50 backdrop-blur-xl border-b border-slate-200 dark:border-white/5 flex justify-between items-center px-4 md:px-12 py-4 z-50 transition-colors duration-300">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
          <img src="/favicon.ico" alt="StoicOPS Logo" className="w-8 h-8 rounded-lg shadow-lg object-contain" />
          <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white uppercase font-label">StoicOPS</span>
        </div>
        
        <div className="hidden md:flex items-center gap-10">
          <a className="text-slate-600 dark:text-slate-300 font-semibold text-sm font-label tracking-wide hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer">Platform</a>
          <a className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors text-sm font-label tracking-wide cursor-pointer">Integrations</a>
          <a className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors text-sm font-label tracking-wide cursor-pointer">Pricing</a>
          <a className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors text-sm font-label tracking-wide cursor-pointer" onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}>Resources</a>
        </div>
        
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <span className="text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer transition-colors hidden sm:block" onClick={() => navigate('/login')}>Log In</span>
          
          <MagneticButton 
            onClick={() => navigate('/login?mode=signup')}
            className="bg-slate-900 dark:bg-purple-500/10 dark:hover:bg-purple-500/20 text-white dark:text-purple-300 border border-transparent dark:border-purple-500/30 px-6 py-2 rounded-full font-bold text-sm shadow-lg z-10"
          >
            Start Earning
          </MagneticButton>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative min-h-[90vh] pt-32 pb-12 px-6 flex items-center justify-center overflow-hidden">
        {/* Animated Aurora Streak */}
        <AnimatedAuroraStreak />

        <div className="max-w-7xl mx-auto w-full grid lg:grid-cols-2 gap-16 items-center relative z-20">
          
          {/* Left Column: Typography & CTAs */}
          <motion.div 
            style={{ y: yHeroText }}
            className="flex flex-col items-start text-left max-w-2xl"
          >
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-purple-500/20 dark:border-purple-400/20 bg-purple-50 dark:bg-purple-400/10 mb-8"
            >
              <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></div>
              <span className="text-[11px] font-bold text-purple-700 dark:text-purple-300 tracking-widest uppercase font-label">Reddit Sync Active</span>
            </motion.div>

            <motion.h1 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1 }}
              className="text-5xl sm:text-6xl md:text-[5.5rem] font-bold tracking-tighter text-slate-900 dark:text-white mb-6 leading-[1.05]"
              style={{ letterSpacing: "-0.04em" }}
            >
              The platform that<br/>
              turns activity into <span className="italic text-purple-600 dark:text-purple-400 font-serif lowercase tracking-normal bg-purple-100/50 dark:bg-transparent px-2 rounded-lg text-[1.1em]">income.</span>
            </motion.h1>

            <motion.p 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="text-lg md:text-xl text-slate-600 dark:text-slate-400 mb-10 font-medium leading-relaxed max-w-xl"
            >
              Your value happens in scattered posts and threads, not ad revenue. 
              StoicOPS ingests this multi-lingual chaos and automatically generates your live crypto payout—zero data entry required.
            </motion.p>

            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto relative z-10"
            >
              <MagneticButton 
                onClick={() => navigate('/login?mode=signup')}
                className="w-full sm:w-auto px-8 py-3.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold rounded-full transition-all hover:scale-105 shadow-xl flex items-center justify-center gap-2" 
              >
                Start Free Earning <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </MagneticButton>
              <MagneticButton 
                onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
                className="w-full sm:w-auto px-8 py-3.5 border border-slate-300 dark:border-white/20 bg-white/50 dark:bg-transparent backdrop-blur-md rounded-full font-bold text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-all flex items-center justify-center"
              >
                Watch System Tour
              </MagneticButton>
            </motion.div>

            {/* Trust Indicators */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1, delay: 0.8 }}
              className="mt-12 flex items-center gap-4"
            >
              <div className="flex -space-x-3">
                <img className="w-10 h-10 rounded-full border-2 border-white dark:border-[#090b14] opacity-90" src="https://i.pravatar.cc/100?img=1" alt="User" />
                <img className="w-10 h-10 rounded-full border-2 border-white dark:border-[#090b14] opacity-90" src="https://i.pravatar.cc/100?img=2" alt="User" />
                <img className="w-10 h-10 rounded-full border-2 border-white dark:border-[#090b14] opacity-90" src="https://i.pravatar.cc/100?img=3" alt="User" />
                <div className="w-10 h-10 rounded-full border-2 border-white dark:border-[#090b14] bg-purple-100 dark:bg-[#1a1230] flex items-center justify-center text-xs font-bold text-purple-700 dark:text-purple-400">
                  +2k
                </div>
              </div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                <div className="flex text-amber-400 text-sm mb-0.5"><Star className="fill-current w-3 h-3" /><Star className="fill-current w-3 h-3" /><Star className="fill-current w-3 h-3" /><Star className="fill-current w-3 h-3" /><Star className="fill-current w-3 h-3" /></div>
                Trusted by <AnimatedCounter from={0} to={1455} /> active taskers
              </div>
            </motion.div>
          </motion.div>

          {/* Right Column: Floating Tilted UI */}
          <motion.div 
            initial={{ opacity: 0, x: 50, rotateY: 20 }}
            animate={{ opacity: 1, x: 0, rotateY: -5 }}
            transition={{ duration: 1.2, type: "spring" }}
            className="relative h-full min-h-[500px] perspective-1000 hidden lg:block"
          >
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-purple-500/20 blur-[100px] rounded-full pointer-events-none z-0"></div>

            {/* Glow Card wrapping the Dashboard */}
            <motion.div 
              animate={{ y: [0, -15, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              className="absolute top-[10%] xl:right-[-5%] w-[480px] bg-white/60 dark:bg-[#131722]/80 backdrop-blur-2xl border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl z-10 glow-card"
              style={{ transform: "rotateY(-12deg) rotateX(5deg)" }}
            >
              <div className="p-6 relative z-10 w-full h-full">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg">
                      <span className="material-symbols-outlined text-slate-700 dark:text-purple-400 text-sm">monitoring</span>
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">Live Revenue Pipeline</div>
                      <div className="text-[10px] text-slate-500">Auto-synced from threads</div>
                    </div>
                  </div>
                  <div className="px-2 py-1 bg-amber-100 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded text-[10px] font-bold text-amber-700 dark:text-amber-400">
                    NEGOTIATING
                  </div>
                </div>

                <div className="space-y-4 mb-6">
                  <div className="p-4 bg-white dark:bg-[#090b14]/50 border border-slate-100 dark:border-white/5 rounded-xl transition-colors hover:border-purple-500/30">
                    <div className="flex justify-between items-center mb-4">
                      <div className="font-bold text-slate-800 dark:text-white text-sm">u/NeonSpecter Thread</div>
                      <div className="font-bold text-purple-600 dark:text-purple-400">₹180.00</div>
                    </div>
                    <div className="relative h-1 w-full bg-slate-200 dark:bg-white/10 rounded-full mb-2">
                      <div className="absolute top-0 left-0 h-1 bg-purple-500 rounded-full w-[40%]"></div>
                      <div className="absolute top-1/2 left-[40%] -translate-y-1/2 w-2 h-2 rounded-full bg-pink-400 border border-[#131722]"></div>
                    </div>
                    <div className="flex justify-between text-[9px] font-label uppercase text-slate-400">
                      <span>Discovery</span>
                      <span className="text-pink-600 dark:text-pink-400">Reviewing</span>
                      <span>Paid</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-white dark:bg-transparent border border-slate-100 dark:border-transparent rounded-lg hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                      <SiReddit className="text-[#ff4500]" /> Review Task
                    </div>
                    <div className="text-xs font-bold text-slate-400">Proposal <span className="text-slate-700 dark:text-white">+₹450.00</span></div>
                  </div>
                </div>

                <div className="w-full flex justify-center gap-1 opacity-40">
                  <div className="w-1 h-3 rounded-full bg-slate-400 dark:bg-white/20"></div>
                  <div className="w-1 h-5 rounded-full bg-slate-400 dark:bg-white/40"></div>
                  <div className="w-1 h-8 rounded-full bg-purple-500 dark:bg-purple-500"></div>
                  <div className="w-1 h-4 rounded-full bg-slate-400 dark:bg-white/20"></div>
                </div>
              </div>
            </motion.div>

            {/* Stacked Small Reddit Cards behind the main panel */}
            <div style={{ transform: "translateZ(-50px) rotateY(-12deg) rotateX(5deg)" }}>
              <FloatingRedditCard username="u/Crimson_Echo_92" amount="315.00" time="8 min ago" delay={0} className="top-[65%] right-[15%] blur-[2px] opacity-70 scale-90 glow-card" />
              <FloatingRedditCard username="u/NomadicVanguard" amount="720.50" time="Just now" delay={0.2} className="top-[-10%] right-[10%] blur-[1px] opacity-90 scale-95 glow-card" />
              <FloatingRedditCard username="u/Pixelated_Drifter" amount="650.00" time="1 min ago" delay={0.4} className="bottom-[-10%] right-[-10%] glow-card" />
            </div>

          </motion.div>
        </div>
      </section>

      {/* INFINITE MARQUEE TICKER */}
      <div className="w-full border-y border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-[#0c0f1a] py-3 overflow-hidden flex relative z-30">
        <div className="animate-marquee gap-8">
          {[...Array(2)].map((_, idx) => (
            <div key={idx} className="flex gap-8 items-center pr-8 whitespace-nowrap">
              <div className="flex items-center gap-2 text-xs font-bold font-label uppercase text-slate-600 dark:text-slate-400 cursor-default hover:text-purple-600 dark:hover:text-purple-400 transition-colors">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]"></span>
                u/QuantumBreeze44 earned <span className="text-purple-600 dark:text-purple-400">₹450.00</span> (1m ago)
              </div>
              <div className="w-1 h-1 bg-slate-300 dark:bg-slate-700 rounded-full"></div>
              <div className="flex items-center gap-2 text-xs font-bold font-label uppercase text-slate-600 dark:text-slate-400 cursor-default hover:text-purple-600 dark:hover:text-purple-400 transition-colors">
                <span className="w-2 h-2 bg-emerald-500 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)]"></span>
                u/NeonSpecter earned <span className="text-purple-600 dark:text-purple-400">₹1,150.00</span> (3m ago)
              </div>
              <div className="w-1 h-1 bg-slate-300 dark:bg-slate-700 rounded-full"></div>
              <div className="flex items-center gap-2 text-xs font-bold font-label uppercase text-slate-600 dark:text-slate-400 cursor-default hover:text-purple-600 dark:hover:text-purple-400 transition-colors">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]"></span>
                u/Iron_Lotus7 earned <span className="text-purple-600 dark:text-purple-400">₹625.00</span> (5m ago)
              </div>
              <div className="w-1 h-1 bg-slate-300 dark:bg-slate-700 rounded-full"></div>
              <div className="flex items-center gap-2 text-xs font-bold font-label uppercase text-slate-600 dark:text-slate-400 cursor-default hover:text-purple-600 dark:hover:text-purple-400 transition-colors">
                <span className="w-2 h-2 bg-emerald-500 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)]"></span>
                u/Lunar_Shift22 earned <span className="text-purple-600 dark:text-purple-400">₹850.00</span> (12m ago)
              </div>
              <div className="w-1 h-1 bg-slate-300 dark:bg-slate-700 rounded-full"></div>
              <div className="flex items-center gap-2 text-xs font-bold font-label uppercase text-slate-600 dark:text-slate-400 cursor-default hover:text-purple-600 dark:hover:text-purple-400 transition-colors">
                <span className="w-2 h-2 bg-emerald-500 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)]"></span>
                u/Silent_Velocity earned <span className="text-purple-600 dark:text-purple-400">₹3,200.00</span> (18m ago)
              </div>
              <div className="w-1 h-1 bg-slate-300 dark:bg-slate-700 rounded-full"></div>
            </div>
          ))}
        </div>
      </div>

      {/* How it Works / Standard Section */}
      <section id="how-it-works" className="py-32 px-6 max-w-7xl mx-auto relative z-20">
        <div className="mb-20 text-center">
          <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white mb-6">Execution Protocol</h2>
          <p className="text-slate-600 dark:text-slate-400 text-lg max-w-2xl mx-auto">Three simple steps to transition from scroller to earner.</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            { 
              step: "01",
              title: "Onboard & Connect", 
              desc: "Link your accounts securely. Our system establishes your baseline reputation within seconds.",
              icon: "link",
              color: "#8b5cf6"
            },
            { 
              step: "02",
              title: "Engage & Execute", 
              desc: "Select tasks matching your interests. Comment, upvote, and interact naturally as you always do.",
              icon: "interactive_space",
              color: "#3b82f6"
            },
            { 
              step: "03",
              title: "Liquidate", 
              desc: "Instant ledger updates. Withdraw your balance to your local currency the moment a task is verified.",
              icon: "account_balance_wallet",
              color: "#10b981"
            }
          ].map((item, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ delay: i * 0.2, duration: 0.6 }}
              className="bg-white dark:bg-[#131722]/50 rounded-3xl p-10 border border-slate-200 dark:border-white/5 hover:border-purple-500/30 hover:shadow-xl transition-all group flex flex-col justify-between glow-card"
            >
              <div className="relative z-10 pointer-events-none">
                <div className="flex justify-between items-start mb-8">
                  <div 
                    className="w-16 h-16 rounded-2xl flex items-center justify-center bg-slate-50 dark:bg-[#090b14] border border-slate-200 dark:border-white/10 group-hover:scale-110 transition-transform duration-500"
                    style={{ color: item.color, boxShadow: `0 0 20px ${item.color}20` }}
                  >
                    <span className="material-symbols-outlined text-3xl">{item.icon}</span>
                  </div>
                  <div className="text-4xl font-bold font-label opacity-10 group-hover:opacity-20 transition-opacity text-slate-900 dark:text-white">{item.step}</div>
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-4">{item.title}</h3>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-sm">{item.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-20 px-6 max-w-4xl mx-auto relative z-20">
        <div className="mb-16 text-center">
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white mb-4">Frequently Asked Questions</h2>
          <p className="text-slate-600 dark:text-slate-400">Everything you need to know about operating on StoicOPS.</p>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, idx) => (
            <FAQCard key={idx} question={faq.q} answer={faq.a} />
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-50 dark:bg-[#090b14] border-t border-slate-200 dark:border-white/10 pt-20 pb-12 relative z-20 transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-8 flex flex-col items-center">
          <div className="flex items-center gap-3 mb-8 opacity-80 dark:opacity-50 hover:opacity-100 transition-opacity cursor-default">
            <img src="/favicon.ico" alt="StoicOPS Logo" className="w-8 h-8 object-contain drop-shadow-md" />
            <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">StoicOPS</span>
          </div>
          <div className="flex gap-8 mb-12">
            <a className="text-slate-500 hover:text-purple-600 dark:hover:text-purple-400 transition-colors text-xs font-label uppercase tracking-widest cursor-pointer">Platform Guidelines</a>
            <a className="text-slate-500 hover:text-purple-600 dark:hover:text-purple-400 transition-colors text-xs font-label uppercase tracking-widest cursor-pointer">Terms & Conditions</a>
            <a className="text-slate-500 hover:text-purple-600 dark:hover:text-purple-400 transition-colors text-xs font-label uppercase tracking-widest cursor-pointer">Privacy Protocol</a>
          </div>
          <div className="text-slate-400 dark:text-slate-600 text-[10px] font-label uppercase tracking-widest">
            © {new Date().getFullYear()} STOICOPS. ALL RIGHTS RESERVED.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
