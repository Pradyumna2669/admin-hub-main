import React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import logo from "@/assets/logo.jpg";

type SplashScreenProps = {
  visible?: boolean;
  title?: string;
  message?: string;
};

const SplashScreen: React.FC<SplashScreenProps> = ({
  visible = true,
  title = "STOIC OPS",
  message = "Initializing...",
}) => {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="splash"
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="fixed inset-0 z-[9999] grid place-items-center overflow-hidden bg-background text-foreground"
          style={{ backgroundImage: "var(--gradient-hero)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.25, ease: "easeOut" }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.16),transparent_28%),radial-gradient(circle_at_top_right,hsl(var(--accent)/0.14),transparent_24%),radial-gradient(circle_at_bottom,hsl(var(--primary)/0.08),transparent_30%)]" />
          <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(to_right,hsl(var(--foreground)/0.16)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--foreground)/0.16)_1px,transparent_1px)] [background-size:52px_52px]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,hsl(var(--background)/0.18)_55%,hsl(var(--background)/0.72)_100%)]" />

          <motion.div
            className="relative mx-auto flex w-full max-w-xl flex-col items-center px-6 text-center"
            initial={{ y: 18, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 10, opacity: 0, scale: 0.99 }}
            transition={{ duration: reduceMotion ? 0 : 0.35, ease: "easeOut" }}
          >
            <div className="dashboard-hero w-full max-w-md px-8 py-10">
              <div className="relative z-10 flex flex-col items-center">
                <div className="relative">
                  <div className="absolute -inset-10 rounded-full bg-primary/15 blur-3xl" />
                  <div className="absolute -inset-14 rounded-full bg-accent/10 blur-3xl" />

                  <div
                    className="relative rounded-[28px] p-[2px]"
                    style={{
                      background:
                        "linear-gradient(135deg, hsl(var(--primary) / 0.95), hsl(var(--accent) / 0.7), hsl(var(--primary) / 0.9))",
                      boxShadow: "var(--shadow-glow)",
                    }}
                  >
                    <div className="glass-panel grid h-28 w-28 place-items-center rounded-[26px] border-0 bg-card/70">
                      <motion.div
                        className="relative"
                        animate={reduceMotion ? undefined : { rotate: 360 }}
                        transition={
                          reduceMotion
                            ? undefined
                            : { duration: 8, ease: "linear", repeat: Infinity }
                        }
                      >
                        <img
                          src={logo}
                          alt="StoicOps logo"
                          className="h-20 w-20 rounded-full border border-border/70 object-cover shadow-[0_0_35px_hsl(var(--primary)/0.28)]"
                        />
                      </motion.div>
                    </div>
                  </div>
                </div>

                <div className="mt-8 space-y-3">
                  <h1 className="text-3xl font-semibold tracking-[0.22em] text-gradient sm:text-4xl">
                    {title}
                  </h1>
                  <p className="text-sm text-muted-foreground sm:text-base">{message}</p>
                </div>

                <div className="mt-8 w-full max-w-xs">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted/70 shadow-inner">
                    <div
                      className="h-2 w-1/2 rounded-full animate-[splashbar_1.25s_ease-in-out_infinite]"
                      style={{ background: "var(--gradient-primary)" }}
                    />
                  </div>
                  <div className="mt-4 text-[11px] tracking-[0.28em] text-muted-foreground/80">
                    SYSTEM ONLINE
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};

export default SplashScreen;
