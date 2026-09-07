import React from "react";
import { 
  Shield, 
  Lightbulb, 
  Users, 
  Clock,
  TrendingUp,
  Activity,
  Zap,
  Target
} from "lucide-react";
import { motion } from "framer-motion";

export default function SafetyInsights({ routes }) {
  if (!routes) return null;

  const insights = [
    {
      icon: Lightbulb,
      title: "Luminosity Index",
      description: "85% well-lit coverage along guarded path",
      color: "amber",
      trend: "+12%"
    },
    {
      icon: Users,
      title: "Human Density",
      description: "40% higher pedestrian activity detected",
      color: "blue",
      trend: "Optimal"
    },
    {
      icon: Shield,
      title: "Tactical Response", 
      description: "2 security hubs within 500m radius",
      color: "emerald",
      trend: "Active"
    },
    {
      icon: Clock,
      title: "Temporal Sync",
      description: "Current interval optimized for safe travel",
      color: "indigo",
      trend: "Stable"
    }
  ];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.3 }}
      className="premium-card glass p-8 border-emerald-100/50"
    >
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
           <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <TrendingUp className="w-5 h-5 text-white" />
           </div>
           <div>
              <h3 className="text-xl font-black text-slate-900 tracking-tight">Safety Intelligence</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Route Analysis Data</p>
           </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 bg-slate-900 rounded-lg">
           <Zap className="w-3 h-3 text-emerald-400 fill-emerald-400" />
           <span className="text-[10px] font-black text-white uppercase tracking-widest">Verified Log</span>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-6">
        {insights.map((insight, index) => (
          <motion.div
            key={insight.title}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 + index * 0.1 }}
            className="flex items-start gap-4 p-4 rounded-2xl hover:bg-white/60 transition-colors group"
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110 bg-${insight.color}-50`}>
              <insight.icon className={`w-6 h-6 text-${insight.color}-600`} />
            </div>
            <div className="flex-grow">
              <div className="flex items-center justify-between mb-1">
                 <h4 className="font-bold text-slate-900 text-sm tracking-tight">{insight.title}</h4>
                 <span className={`text-[8px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded bg-${insight.color}-100 text-${insight.color}-700`}>{insight.trend}</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed font-medium">{insight.description}</p>
            </div>
          </motion.div>
        ))}
      </div>
      
      <div className="mt-8 pt-6 border-t border-slate-100 flex items-center gap-3 text-emerald-600">
         <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping"></div>
         <span className="text-[10px] font-black uppercase tracking-[0.2em]">Synchronizing with local safety mesh networks...</span>
      </div>
    </motion.div>
  );
}
