"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  LayoutDashboard,
  Users,
  Bus,
  MapPin,
  Calendar,
  CalendarDays,
  Package,
  DollarSign,
  Trophy,
  FileText,
  Bell,
  Settings,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  BookOpen,
  BookOpenCheck,
  MessageSquare,
  PenTool,
  HelpCircle,
  Upload,
  FileQuestion,
  Clock,
  BarChart3,
  Presentation,
  School,
  Sparkles,
  FileCheck,
  Trash2,
  Bot,
  TrendingUp,
  Wallet,
  Database,
  GitMerge,
  ArrowLeftRight,
  ShieldCheck,
} from "lucide-react";

interface NavItem {
  title: string;
  href: string;
  icon: React.ReactNode;
  badge?: string;
  category?: string;
}

const adminNavItems: NavItem[] = [
  {
    title: "Dashboard",
    href: "/admin/dashboard",
    icon: <LayoutDashboard className="h-5 w-5" />,
    category: "Overview",
  },
  {
    title: "Admission Management",
    href: "/admin/admissions",
    icon: <ClipboardList className="h-5 w-5" />,
    category: "Management",
  },
  {
    title: "Teacher Appointment",
    href: "/admin/teacher-appointments",
    icon: <Users className="h-5 w-5" />,
    category: "Management",
  },
  {
    title: "User Management",
    href: "/admin/users",
    icon: <Users className="h-5 w-5" />,
    category: "Management",
  },
  {
    title: "Class Management",
    href: "/admin/class-management",
    icon: <BookOpen className="h-5 w-5" />,
    category: "Management",
  },
  {
    title: "Exam Management",
    href: "/admin/exam-management",
    icon: <BookOpenCheck className="h-5 w-5" />,
    category: "Management",
  },
  {
    title: "Transfers",
    href: "/admin/transfers",
    icon: <ArrowLeftRight className="h-5 w-5" />,
    category: "Management",
  },
  {
    title: "Compliance",
    href: "/admin/compliance",
    icon: <ShieldCheck className="h-5 w-5" />,
    category: "Management",
  },
  {
    title: "Bus Routes",
    href: "/admin/bus-routes",
    icon: <Bus className="h-5 w-5" />,
    category: "Operations",
  },
  {
    title: "Bus Tracking",
    href: "/admin/bus-tracking",
    icon: <MapPin className="h-5 w-5" />,
    category: "Operations",
  },
  {
    title: "Students Timetable",
    href: "/admin/students-timetable",
    icon: <Calendar className="h-5 w-5" />,
    category: "Operations",
  },
  {
    title: "Teachers Timetable",
    href: "/admin/teachers-timetable",
    icon: <CalendarDays className="h-5 w-5" />,
    category: "Operations",
  },
  {
    title: "Resource Inventory",
    href: "/admin/inventory",
    icon: <Package className="h-5 w-5" />,
    category: "Operations",
  },
  {
    title: "Fee Management",
    href: "/admin/fees",
    icon: <DollarSign className="h-5 w-5" />,
    category: "Finance",
  },
  {
    title: "Salary Management",
    href: "/admin/salary-management",
    icon: <Wallet className="h-5 w-5" />,
    category: "Finance",
  },
  {
    title: "Event Calendar",
    href: "/admin/events",
    icon: <CalendarDays className="h-5 w-5" />,
    category: "Events",
  },
  {
    title: "Teachers Leaderboard",
    href: "/admin/teachers-leaderboard",
    icon: <Trophy className="h-5 w-5" />,
    category: "Analytics",
  },
  {
    title: "Students Leaderboard",
    href: "/admin/students-leaderboard",
    icon: <Trophy className="h-5 w-5" />,
    category: "Analytics",
  },
  {
    title: "Reports",
    href: "/admin/reports",
    icon: <FileText className="h-5 w-5" />,
    category: "Analytics",
  },
];

const teacherNavItems: NavItem[] = [
  {
    title: "Dashboard",
    href: "/teacher/dashboard",
    icon: <LayoutDashboard className="h-5 w-5" />,
    category: "Overview",
  },
  {
    title: "Teach",
    href: "/teacher/teach",
    icon: <Presentation className="h-5 w-5" />,
    category: "Teaching",
  },
  {
    title: "Quiz Scheduler",
    href: "/teacher/quiz-scheduler",
    icon: <HelpCircle className="h-5 w-5" />,
    category: "Teaching",
  },
  {
    title: "Homework",
    href: "/teacher/homework",
    icon: <BookOpen className="h-5 w-5" />,
    category: "Teaching",
  },
  {
    title: "Materials",
    href: "/teacher/materials",
    icon: <FileText className="h-5 w-5" />,
    category: "Resources",
  },
  {
    title: "Question Uploader",
    href: "/teacher/question-generator",
    icon: <FileQuestion className="h-5 w-5" />,
    category: "Resources",
  },
  {
    title: "Question Papers",
    href: "/teacher/question-papers",
    icon: <FileCheck className="h-5 w-5" />,
    category: "Resources",
  },
  {
    title: "Students Timetable",
    href: "/teacher/students-timetable",
    icon: <Calendar className="h-5 w-5" />,
    category: "Schedule",
  },
  {
    title: "Teachers Timetable",
    href: "/teacher/teachers-timetable",
    icon: <CalendarDays className="h-5 w-5" />,
    category: "Schedule",
  },
  {
    title: "Calendar",
    href: "/teacher/calendar",
    icon: <Calendar className="h-5 w-5" />,
    category: "Schedule",
  },
  {
    title: "Attendance",
    href: "/teacher/attendance-upload",
    icon: <Upload className="h-5 w-5" />,
    category: "Admin",
  },
  {
    title: "Report Management",
    href: "/teacher/reports",
    icon: <BarChart3 className="h-5 w-5" />,
    category: "Admin",
  },
  {
    title: "Fee Overview",
    href: "/teacher/fees",
    icon: <DollarSign className="h-5 w-5" />,
    category: "Admin",
  },
  {
    title: "Leaderboard",
    href: "/teacher/leaderboard",
    icon: <Trophy className="h-5 w-5" />,
    category: "Performance",
  },
  {
    title: "Messages",
    href: "/teacher/messages",
    icon: <MessageSquare className="h-5 w-5" />,
    category: "Communication",
  },
];

const studentNavItems: NavItem[] = [
  {
    title: "Dashboard",
    href: "/student/dashboard",
    icon: <LayoutDashboard className="h-5 w-5" />,
    category: "Overview",
  },
  {
    title: "Leaderboard",
    href: "/student/leaderboard",
    icon: <Trophy className="h-5 w-5" />,
    category: "Performance",
  },
  {
    title: "Quizzes",
    href: "/student/quizzes",
    icon: <HelpCircle className="h-5 w-5" />,
    category: "Learning",
  },
  {
    title: "Messages",
    href: "/student/messages",
    icon: <MessageSquare className="h-5 w-5" />,
    category: "Communication",
  },
  {
    title: "Homework",
    href: "/student/homework",
    icon: <BookOpenCheck className="h-5 w-5" />,
    category: "Learning",
  },
  {
    title: "Timetable",
    href: "/student/timetable",
    icon: <Calendar className="h-5 w-5" />,
    category: "Schedule",
  },
  {
    title: "Calendar",
    href: "/student/calendar",
    icon: <CalendarDays className="h-5 w-5" />,
    category: "Schedule",
  },
  {
    title: "Materials",
    href: "/student/materials",
    icon: <BookOpen className="h-5 w-5" />,
    category: "Learning",
  },
  {
    title: "Fees",
    href: "/student/fees",
    icon: <DollarSign className="h-5 w-5" />,
    category: "Finance",
  },
  {
    title: "Attendance",
    href: "/student/attendance",
    icon: <ClipboardList className="h-5 w-5" />,
    category: "Records",
  },
  {
    title: "Feedback",
    href: "/student/feedback",
    icon: <MessageSquare className="h-5 w-5" />,
    category: "Communication",
  },
  {
    title: "Reports",
    href: "/student/reports",
    icon: <FileText className="h-5 w-5" />,
    category: "Records",
  },
];

const superAdminNavItems: NavItem[] = [
  {
    title: "Schools",
    href: "/super-admin?tab=schools",
    icon: <School className="h-5 w-5" />,
    category: "Overview",
  },
  {
    title: "User Growth",
    href: "/super-admin?tab=users",
    icon: <TrendingUp className="h-5 w-5" />,
    category: "Analytics",
  },
  {
    title: "Storage",
    href: "/super-admin?tab=storage",
    icon: <Database className="h-5 w-5" />,
    category: "Analytics",
  },
  {
    title: "Catalog",
    href: "/super-admin?tab=catalog",
    icon: <BookOpen className="h-5 w-5" />,
    category: "Overview",
  },
  {
    title: "Demo Requests",
    href: "/super-admin?tab=demo-requests",
    icon: <ClipboardList className="h-5 w-5" />,
    category: "Overview",
  },
  {
    title: "Reconciliations",
    href: "/super-admin?tab=reconciliations",
    icon: <GitMerge className="h-5 w-5" />,
    category: "Overview",
  },
  {
    title: "Question Uploader",
    href: "/super-admin?tab=question-uploader",
    icon: <FileQuestion className="h-5 w-5" />,
    category: "Resources",
  },
  {
    title: "Quiz Scheduler",
    href: "/super-admin?tab=quiz-scheduler",
    icon: <HelpCircle className="h-5 w-5" />,
    category: "Resources",
  },
  {
    title: "Materials",
    href: "/super-admin?tab=materials",
    icon: <BookOpenCheck className="h-5 w-5" />,
    category: "Resources",
  },
  {
    title: "Blog Management",
    href: "/super-admin?tab=blogs",
    icon: <PenTool className="h-5 w-5" />,
    category: "Resources",
  },
  {
    title: "Settings",
    href: "/super-admin?tab=settings",
    icon: <Settings className="h-5 w-5" />,
    category: "Management",
  },
  {
    title: "Trash",
    href: "/super-admin?tab=trash",
    icon: <Trash2 className="h-5 w-5" />,
    category: "Management",
  },
  {
    title: "Help Center",
    href: "/super-admin?tab=help-center",
    icon: <HelpCircle className="h-5 w-5" />,
    category: "Management",
  },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { userRole } = useAuth();

  // Track mobile state and listen for toggle events from Header
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setCollapsed(false); // show full sidebar content when opened on mobile
      }
    };

    const handleToggleMobile = () => {
      setMobileOpen((prev) => !prev);
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    window.addEventListener("toggle-mobile-sidebar", handleToggleMobile);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("toggle-mobile-sidebar", handleToggleMobile);
    };
  }, []);

  useEffect(() => {
    // Keep strict UI boundaries between auth identities.
    setCollapsed(false);
    setMobileOpen(false);
  }, [userRole]);

  const getNavItems = (): NavItem[] => {
    switch (userRole) {
      case "admin":
        return adminNavItems;
      case "super_admin":
        return superAdminNavItems;
      case "teacher":
        return teacherNavItems;
      case "student":
        return studentNavItems;
      default:
        return [];
    }
  };

  const isNavItemActive = (href: string) => {
    if (!href.includes("?")) {
      return pathname === href;
    }

    const [targetPath, query] = href.split("?");
    if (pathname !== targetPath) return false;

    const params = new URLSearchParams(query);
    for (const [key, value] of params.entries()) {
      if (searchParams.get(key) !== value) return false;
    }
    return true;
  };

  const roleConfig = {
    admin: {
      gradient: "from-violet-600 via-purple-600 to-indigo-600",
      accentColor: "violet",
      glowColor: "rgba(139, 92, 246, 0.3)",
    },
    super_admin: {
      gradient: "from-rose-600 via-red-600 to-orange-500",
      accentColor: "rose",
      glowColor: "rgba(225, 29, 72, 0.3)",
    },
    teacher: {
      gradient: "from-emerald-500 via-teal-500 to-cyan-600",
      accentColor: "emerald",
      glowColor: "rgba(16, 185, 129, 0.3)",
    },
    student: {
      gradient: "from-orange-500 via-amber-500 to-yellow-500",
      accentColor: "amber",
      glowColor: "rgba(251, 146, 60, 0.3)",
    },
  };

  const config =
    roleConfig[userRole as keyof typeof roleConfig] || roleConfig.admin;

  const navItems = getNavItems();

  // Group items by category
  const groupedItems = navItems.reduce(
    (acc, item) => {
      const category = item.category || "Other";
      if (!acc[category]) acc[category] = [];
      acc[category].push(item);
      return acc;
    },
    {} as Record<string, NavItem[]>,
  );

  return (
    <TooltipProvider delayDuration={0}>
      {/* Mobile backdrop overlay */}
      {isMobile && mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm transition-opacity duration-300"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={cn(
          "relative flex flex-col h-[100dvh] border-r transition-all duration-300 ease-in-out",
          "bg-background",
          "shadow-xl",
          isMobile
            ? "fixed top-0 left-0 z-50 w-[270px] transform transition-transform duration-300 ease-in-out"
            : "",
          isMobile && !mobileOpen ? "-translate-x-full" : "translate-x-0",
          // rem-based so the sidebar scales with the fluid root font-size on 4K/TV
          !isMobile && (collapsed ? "w-[5rem]" : "w-[17.5rem]"),
        )}
      >
        {/* Decorative gradient overlay */}
        <div
          className={cn(
            "absolute top-0 left-0 right-0 h-20 opacity-10 pointer-events-none",
            `bg-gradient-to-b ${config.gradient}`,
          )}
        />

        {/* Logo Section */}
        <div className="relative flex h-20 items-center justify-between px-4 border-b border-border/50">
          {!collapsed && (
            <Link href="" className="flex items-center gap-2 group">
              <Image
                src="/assets/icon-transbg.png"
                alt="Schools24 Logo"
                width={44}
                height={44}
                className="h-11 w-11 object-contain transition-transform duration-300 group-hover:scale-105"
                priority
              />
              <span
                className={cn(
                  "font-bold text-xl tracking-tight",
                  `bg-gradient-to-r ${config.gradient} bg-clip-text text-transparent`,
                )}
              >
                Schools24
              </span>
            </Link>
          )}
          {collapsed && (
            <div className="flex items-center justify-center mx-auto">
              <Image
                src="/assets/icon-transbg.png"
                alt="Schools24 Logo"
                width={40}
                height={40}
                className="h-10 w-10 object-contain transition-transform duration-300 hover:scale-105"
                priority
              />
            </div>
          )}
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 px-3 py-4">
          <nav className="space-y-6">
            {Object.entries(groupedItems).map(([category, items]) => (
              <div key={category} className="space-y-1">
                {!collapsed && (
                  <h4 className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {category}
                  </h4>
                )}
                {collapsed && items.length > 0 && (
                  <Separator className="my-2" />
                )}
                {items.map((item) => {
                  const isActive = isNavItemActive(item.href);

                  if (collapsed) {
                    return (
                      <Tooltip key={item.href}>
                        <TooltipTrigger asChild>
                          <Link
                            href={item.href}
                            onClick={() => isMobile && setMobileOpen(false)}
                            className={cn(
                              "relative flex h-11 w-11 items-center justify-center rounded-xl mx-auto",
                              "transition-all duration-200 group",
                              isActive
                                ? cn(
                                    `bg-gradient-to-br ${config.gradient} text-white`,
                                    "shadow-lg scale-105",
                                  )
                                : "text-muted-foreground hover:text-foreground hover:bg-accent/50 hover:scale-105",
                            )}
                            style={
                              isActive
                                ? {
                                    boxShadow: `0 4px 16px ${config.glowColor}`,
                                  }
                                : {}
                            }
                          >
                            {isActive && (
                              <div className="absolute inset-0 rounded-xl bg-white/10 animate-pulse" />
                            )}
                            {item.icon}
                            {item.badge && (
                              <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] text-white font-bold shadow-lg">
                                {item.badge}
                              </span>
                            )}
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="font-medium">
                          {item.title}
                        </TooltipContent>
                      </Tooltip>
                    );
                  }

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => isMobile && setMobileOpen(false)}
                      className={cn(
                        "relative flex items-center gap-3 rounded-xl px-3 py-2.5",
                        "transition-all duration-200 group overflow-hidden",
                        isActive
                          ? cn(
                              `bg-gradient-to-r ${config.gradient} text-white`,
                              "shadow-lg font-medium",
                            )
                          : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                      )}
                      style={
                        isActive
                          ? { boxShadow: `0 4px 16px ${config.glowColor}` }
                          : {}
                      }
                    >
                      {/* Active indicator */}
                      {isActive && (
                        <>
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-white rounded-r-full" />
                          <div className="absolute inset-0 bg-gradient-to-r from-white/10 via-transparent to-transparent" />
                        </>
                      )}

                      {/* Hover shimmer effect */}
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />

                      <div
                        className={cn(
                          "relative z-10 transition-transform duration-200",
                          isActive ? "scale-110" : "group-hover:scale-110",
                        )}
                      >
                        {item.icon}
                      </div>
                      <span className="relative z-10 flex-1 font-medium text-sm">
                        {item.title}
                      </span>
                      {item.badge && (
                        <Badge
                          variant={isActive ? "secondary" : "default"}
                          className={cn(
                            "relative z-10 h-5 min-w-5 px-1.5 text-[10px] font-bold",
                            isActive
                              ? "bg-white/20 text-white border-white/30"
                              : "",
                          )}
                        >
                          {item.badge}
                        </Badge>
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </ScrollArea>

        {/* Collapse Button — hidden on mobile */}
        {!isMobile && (
          <div className="relative border-t border-border/50 p-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCollapsed(!collapsed)}
              className={cn(
                "w-full justify-center transition-all duration-200",
                "hover:bg-accent/50 rounded-xl",
                collapsed ? "px-0" : "gap-2",
              )}
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <>
                  <ChevronLeft className="h-4 w-4" />
                  <span className="font-medium text-sm">Collapse</span>
                </>
              )}
            </Button>
          </div>
        )}
        {/* Close button for mobile */}
        {isMobile && (
          <div className="relative border-t border-border/50 p-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMobileOpen(false)}
              className="w-full justify-center gap-2 hover:bg-accent/50 rounded-xl"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="font-medium text-sm">Close</span>
            </Button>
          </div>
        )}
      </aside>
    </TooltipProvider>
  );
}
