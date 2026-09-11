import React, { useState, useEffect, useCallback } from "react";
import { User, EmergencyContact } from "@/entities/all";
import { supabase } from "../src/lib/supabase.js";
import UserAvatar, { AVATAR_OPTIONS } from "@/components/UserAvatar.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Label } from "@/components/ui/label.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Progress } from "@/components/ui/progress.jsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.jsx";
import { 
  User as UserIcon, 
  Shield, 
  Phone, 
  AlertCircle, 
  Zap, 
  CheckCircle, 
  XCircle, 
  ArrowRight, 
  Plus, 
  Trash2, 
  Edit3, 
  Users, 
  ShieldCheck, 
  Check, 
  X,
  UserCheck,
  ShieldAlert,
  UserPlus,
  Camera,
  MapPin,
  Compass
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { 
  getTrustedPlaces, 
  addTrustedPlace, 
  updateTrustedPlace, 
  deleteTrustedPlace 
} from "../services/trustedPlacesService.js";
import TrustedPlacesSection from "../components/navigation/TrustedPlacesSection.jsx";
import AddEditTrustedPlaceModal from "../components/navigation/AddEditTrustedPlaceModal.jsx";
import TrustedPlaceDetailsCard from "../components/navigation/TrustedPlaceDetailsCard.jsx";
import { motion, AnimatePresence } from "framer-motion";

export default function Profile() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [trustedPlaces, setTrustedPlaces] = useState([]);
  const [trustedPlacesCount, setTrustedPlacesCount] = useState(0);
  const [selectedTrustedPlace, setSelectedTrustedPlace] = useState(null);
  const [isAddEditPlaceModalOpen, setIsAddEditPlaceModalOpen] = useState(false);
  const [editingPlace, setEditingPlace] = useState(null);
  const [placeFeedback, setPlaceFeedback] = useState(null);
  const [profileFeedback, setProfileFeedback] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Modals & form state
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [showChooseGuardianModal, setShowChooseGuardianModal] = useState(false);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [selectedAvatarId, setSelectedAvatarId] = useState("avatar_01");
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarFeedback, setAvatarFeedback] = useState(null);
  const [selectedGuardianCandidateId, setSelectedGuardianCandidateId] = useState(null);
  const [contactToDelete, setContactToDelete] = useState(null);

  // Form input state
  const [profileForm, setProfileForm] = useState({
    full_name: "",
    phone: "",
    auto_share_location: true,
    sos_notifications: true
  });

  const [contactForm, setContactForm] = useState({
    name: "",
    phone: "",
    email: "",
    relationship: "family"
  });

  // Load User Data & Emergency Contacts
  const loadUserData = useCallback(async () => {
    try {
      setLoading(true);

      let authUser = null;
      try {
        const { data: { user: sbUser } } = await supabase.auth.getUser();
        authUser = sbUser;
      } catch (err) {
        console.warn("Could not retrieve auth user:", err);
      }

      const localUser = await User.me();
      let dbUser = null;
      const targetUserId = authUser?.id || localUser?.id;

      if (targetUserId) {
        try {
          const { data: userData } = await supabase
            .from("users")
            .select("*")
            .eq("id", targetUserId)
            .single();
          dbUser = userData;
        } catch (err) {
          console.warn("Could not query users table:", err);
        }
      }

      const mergedUser = {
        id: targetUserId || null,
        full_name: dbUser?.full_name || authUser?.user_metadata?.full_name || localUser?.full_name || "",
        email: dbUser?.email || authUser?.email || localUser?.email || "",
        phone: dbUser?.phone || localUser?.phone || "",
        avatar_id: authUser?.user_metadata?.avatar_id || localUser?.avatar_id || localUser?.user_metadata?.avatar_id || "avatar_01",
        safety_preferences: {
          auto_share_location: true,
          sos_notifications: true,
          guardian_contact_id: null,
          ...(localUser?.safety_preferences || {})
        }
      };

      setUser(mergedUser);

      setProfileForm({
        full_name: mergedUser.full_name,
        phone: mergedUser.phone,
        auto_share_location: mergedUser.safety_preferences.auto_share_location !== false,
        sos_notifications: mergedUser.safety_preferences.sos_notifications !== false
      });

      const emergencyContacts = await EmergencyContact.list();
      setContacts(emergencyContacts || []);

      const places = await getTrustedPlaces(targetUserId);
      setTrustedPlaces(places || []);
      setTrustedPlacesCount(places?.length || 0);

    } catch (error) {
      console.error("Error loading profile data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleAddPlaceClick = () => {
    setEditingPlace(null);
    setIsAddEditPlaceModalOpen(true);
  };

  const handleEditPlaceClick = (place) => {
    setEditingPlace(place);
    setIsAddEditPlaceModalOpen(true);
  };

  const handleSavePlace = async (placePayload) => {
    try {
      const activeUserId = user?.id;
      let savedPlace = null;
      if (editingPlace) {
        savedPlace = await updateTrustedPlace(editingPlace.id, placePayload, activeUserId);
        setPlaceFeedback({ type: "success", message: `Updated "${placePayload.place_name}" successfully.` });
      } else {
        savedPlace = await addTrustedPlace(placePayload, activeUserId);
        setPlaceFeedback({ type: "success", message: `Added "${placePayload.place_name}" to Trusted Places.` });
      }
      if (savedPlace) {
        setSelectedTrustedPlace(savedPlace);
      }
      await loadUserData();
      setIsAddEditPlaceModalOpen(false);
      setEditingPlace(null);
      setTimeout(() => setPlaceFeedback(null), 4000);
    } catch (err) {
      console.error("Error saving trusted place:", err);
      setPlaceFeedback({ type: "error", message: err.message || "Failed to save trusted place." });
    }
  };

  const handleDeletePlace = async (placeId) => {
    try {
      await deleteTrustedPlace(placeId, user?.id);
      if (selectedTrustedPlace?.id === placeId) {
        setSelectedTrustedPlace(null);
      }
      await loadUserData();
      setPlaceFeedback({ type: "success", message: "Trusted place deleted." });
      setTimeout(() => setPlaceFeedback(null), 4000);
    } catch (err) {
      console.error("Error deleting trusted place:", err);
      setPlaceFeedback({ type: "error", message: "Failed to delete trusted place." });
    }
  };

  const handleNavigateToPlace = (place) => {
    if (!place?.latitude || !place?.longitude) return;
    navigate(`/safenavigation?destLat=${place.latitude}&destLon=${place.longitude}&destLabel=${encodeURIComponent(place.place_name)}`);
  };

  useEffect(() => {
    loadUserData();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      EmergencyContact.clearCache();
      if (session?.user) {
        loadUserData();
      }
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, [loadUserData]);

  // Save User Profile Changes
  const handleSaveProfile = async (e) => {
    if (e) e.preventDefault();
    setSaving(true);

    try {
      const userId = user?.id;

      if (userId) {
        const { error: dbErr } = await supabase
          .from("users")
          .update({
            full_name: profileForm.full_name.trim(),
            phone: profileForm.phone.trim()
          })
          .eq("id", userId);

        if (dbErr) {
          console.warn("Supabase user update notice:", dbErr.message);
        }
      }

      await User.updateMyUserData({
        full_name: profileForm.full_name.trim(),
        phone: profileForm.phone.trim(),
        safety_preferences: {
          ...user?.safety_preferences,
          auto_share_location: profileForm.auto_share_location,
          sos_notifications: profileForm.sos_notifications
        }
      });

      await loadUserData();
      setShowEditProfileModal(false);
    } catch (error) {
      console.error("Error updating profile:", error);
    } finally {
      setSaving(false);
    }
  };

  // Save Avatar Selection
  const handleSaveAvatar = async () => {
    if (!selectedAvatarId || !user) return;
    setAvatarSaving(true);
    setAvatarFeedback(null);

    try {
      // Update Supabase Auth user_metadata
      const { error: sbErr } = await supabase.auth.updateUser({
        data: { avatar_id: selectedAvatarId }
      });

      if (sbErr) {
        console.warn("Supabase auth metadata update notice:", sbErr.message);
      }

      // Update local store
      await User.updateMyUserData({
        avatar_id: selectedAvatarId
      });

      setUser((prev) => (prev ? { ...prev, avatar_id: selectedAvatarId } : null));

      // Notify layout top navigation
      window.dispatchEvent(new Event("user_avatar_changed"));

      setAvatarFeedback({ message: "Profile avatar updated.", type: "success" });
      setTimeout(() => {
        setShowAvatarModal(false);
        setAvatarFeedback(null);
      }, 900);
    } catch (err) {
      console.error("Error updating avatar:", err);
      setAvatarFeedback({ message: "Unable to update your avatar. Please try again.", type: "error" });
    } finally {
      setAvatarSaving(false);
    }
  };

  // Add Emergency Contact
  const handleAddContact = async (e) => {
    e.preventDefault();
    if (!contactForm.name.trim() || !contactForm.phone.trim()) return;

    setSaving(true);
    try {
      await EmergencyContact.create({
        full_name: contactForm.name.trim(),
        name: contactForm.name.trim(),
        number: contactForm.phone.trim(),
        phone: contactForm.phone.trim(),
        email: contactForm.email.trim(),
        relationship: contactForm.relationship || "family"
      });

      setContactForm({
        name: "",
        phone: "",
        email: "",
        relationship: "family"
      });

      await loadUserData();
      setShowAddContactModal(false);
    } catch (error) {
      console.error("Error adding emergency contact:", error);
    } finally {
      setSaving(false);
    }
  };

  // Delete Emergency Contact
  const confirmDeleteContact = async () => {
    if (!contactToDelete) return;

    try {
      // If the deleted contact was the assigned guardian, clear guardian role first
      if (user?.safety_preferences?.guardian_contact_id === contactToDelete.id) {
        await handleSetGuardianRole(null);
      }

      await EmergencyContact.delete(contactToDelete.id);
      setContactToDelete(null);
      await loadUserData();
    } catch (error) {
      console.error("Error deleting contact:", error);
    }
  };

  // Assign or Remove Guardian Role for an Emergency Contact
  const handleSetGuardianRole = async (contactId) => {
    if (!user) return;
    const updatedPreferences = {
      ...user.safety_preferences,
      guardian_contact_id: contactId
    };

    await User.updateMyUserData({
      safety_preferences: updatedPreferences
    });

    setUser(prev => prev ? { ...prev, safety_preferences: updatedPreferences } : null);
    setShowChooseGuardianModal(false);
  };

  // Toggle Preference (Location Sharing / SOS Notifications)
  const handleTogglePreference = async (key) => {
    if (!user) return;
    const newPreferences = {
      ...user.safety_preferences,
      [key]: !user.safety_preferences[key]
    };

    setProfileForm(prev => ({ ...prev, [key]: newPreferences[key] }));

    await User.updateMyUserData({
      safety_preferences: newPreferences
    });

    setUser(prev => prev ? { ...prev, safety_preferences: newPreferences } : null);
  };

  // -------------------------------------------------------------
  // CALCULATIONS (Trust Score, Profile Completion, Notifications)
  // -------------------------------------------------------------

  // Get active assigned Guardian contact from contacts array
  const activeGuardianContact = contacts.find(
    c => c.id === user?.safety_preferences?.guardian_contact_id
  );

  // 1. TRUST SCORE (100-Point System)
  const calculateTrustScore = () => {
    let score = 0;
    const factors = [];

    // Identity / Profile verified = 15 points
    const isIdentityVerified = !!(user?.full_name?.trim() && user?.email?.trim());
    if (isIdentityVerified) {
      score += 15;
      factors.push({ id: 'identity', label: 'Identity verified', points: 15, passed: true });
    } else {
      factors.push({ id: 'identity', label: 'Identity not verified', points: 0, passed: false });
    }

    // Emergency contact added = 25 points
    const hasEmergencyContact = contacts.length > 0;
    if (hasEmergencyContact) {
      score += 25;
      factors.push({ id: 'contact_added', label: 'Emergency contact added', points: 25, passed: true });
    } else {
      factors.push({ id: 'contact_added', label: 'Emergency contact missing', points: 0, passed: false });
    }

    // Emergency contact verified = 15 points
    const primaryContact = contacts.find(c => c.is_primary) || contacts[0];
    const contactPhoneDigits = (primaryContact?.phone || primaryContact?.number || "").replace(/\D/g, "");
    const isContactVerified = hasEmergencyContact && contactPhoneDigits.length >= 10;
    if (isContactVerified) {
      score += 15;
      factors.push({ id: 'contact_verified', label: 'Contact verified', points: 15, passed: true });
    } else {
      factors.push({ id: 'contact_verified', label: 'Contact unverified', points: 0, passed: false });
    }

    // Guardian connected = 20 points (Assigned from an existing Emergency Contact)
    const hasGuardianRole = !!activeGuardianContact;
    if (hasGuardianRole) {
      score += 20;
      factors.push({ id: 'guardian', label: 'Guardian role assigned (+20)', points: 20, passed: true });
    } else {
      factors.push({ id: 'guardian', label: 'Guardian not connected (+0)', points: 0, passed: false });
    }

    // SOS notifications enabled = 10 points
    const sosEnabled = user?.safety_preferences?.sos_notifications !== false;
    if (sosEnabled) {
      score += 10;
      factors.push({ id: 'sos_notifications', label: 'SOS notifications enabled', points: 10, passed: true });
    } else {
      factors.push({ id: 'sos_notifications', label: 'SOS notifications disabled', points: 0, passed: false });
    }

    // Location sharing enabled = 15 points
    const locationEnabled = user?.safety_preferences?.auto_share_location === true;
    if (locationEnabled) {
      score += 15;
      factors.push({ id: 'location_sharing', label: 'Location sharing enabled', points: 15, passed: true });
    } else {
      factors.push({ id: 'location_sharing', label: 'Location sharing disabled', points: 0, passed: false });
    }

    let label = "Incomplete";
    if (score >= 90) label = "Excellent";
    else if (score >= 75) label = "Good";
    else if (score >= 50) label = "Needs Attention";

    return { score, label, factors };
  };

  const trustScoreObj = calculateTrustScore();

  // 2. PROFILE COMPLETION PERCENTAGE (Guardian is optional, required fields = 5)
  const calculateProfileCompletion = () => {
    const requiredFields = [
      { name: "Full Name", complete: !!user?.full_name?.trim() },
      { name: "Email Address", complete: !!user?.email?.trim() },
      { name: "Mobile Phone", complete: !!user?.phone?.trim() },
      { name: "Emergency Contact", complete: contacts.length > 0 },
      { name: "Safety Preferences", complete: !!user?.safety_preferences }
    ];

    const completedCount = requiredFields.filter(f => f.complete).length;
    const percentage = Math.round((completedCount / requiredFields.length) * 100);

    return { percentage, completedCount, totalCount: requiredFields.length };
  };

  const profileCompletion = calculateProfileCompletion();

  // 3. PROFILE UPDATE NOTIFICATION BANNER
  const getNotificationBanner = () => {
    const hasEmergencyContact = contacts.length > 0;
    const hasPhone = !!user?.phone?.trim();
    const hasGuardian = !!activeGuardianContact;

    if (!hasEmergencyContact) {
      return {
        title: "Your safety profile is incomplete.",
        message: "Add an emergency contact so Safe Streets can notify them during an SOS.",
        actionText: "Add Emergency Contact",
        actionFn: () => setShowAddContactModal(true),
        type: "danger"
      };
    }

    if (!hasPhone) {
      return {
        title: "Your safety profile is missing a mobile number.",
        message: "Add your mobile phone number to allow emergency SMS notifications.",
        actionText: "Update Profile",
        actionFn: () => setShowEditProfileModal(true),
        type: "warning"
      };
    }

    if (!hasGuardian) {
      return {
        title: "Assign a guardian to increase your Trust Score by +20 points.",
        message: "Choose one of your emergency contacts as your trusted guardian.",
        actionText: "Choose Guardian",
        actionFn: () => {
          setSelectedGuardianCandidateId(contacts[0]?.id || null);
          setShowChooseGuardianModal(true);
        },
        type: "info"
      };
    }

    return null;
  };

  const notificationBanner = getNotificationBanner();

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-8 flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin"></div>
          <p className="text-slate-600 font-bold uppercase tracking-widest text-xs">Loading Safety Profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-10 pb-20 px-4 sm:px-6">
      
      {/* PAGE HEADER */}
      <div className="pb-6 border-b border-slate-200/80">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
          Safety <span className="text-emerald-600">Profile</span>
        </h1>
        <p className="text-base font-medium text-slate-600 mt-1">
          Manage your personal details, emergency contacts, and guardian safety role.
        </p>
      </div>

      {/* NOTIFICATION BANNER */}
      {notificationBanner && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-6 rounded-3xl border flex flex-col md:flex-row md:items-center justify-between gap-5 shadow-sm ${
            notificationBanner.type === "danger"
              ? "bg-rose-50/90 border-rose-200 text-rose-950"
              : notificationBanner.type === "warning"
              ? "bg-amber-50/90 border-amber-200 text-amber-950"
              : "bg-blue-50/90 border-blue-200 text-blue-950"
          }`}
        >
          <div className="flex items-start gap-4">
            <div className={`p-3 rounded-2xl shrink-0 ${
              notificationBanner.type === "danger"
                ? "bg-rose-100 text-rose-600"
                : notificationBanner.type === "warning"
                ? "bg-amber-100 text-amber-600"
                : "bg-blue-100 text-blue-600"
            }`}>
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-bold text-base sm:text-lg">{notificationBanner.title}</h4>
              <p className="text-sm font-medium text-slate-600 mt-1">{notificationBanner.message}</p>
            </div>
          </div>

          <Button
            onClick={notificationBanner.actionFn}
            size="lg"
            className={`shrink-0 font-bold text-sm rounded-2xl px-6 py-3 ${
              notificationBanner.type === "danger"
                ? "bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-200"
                : notificationBanner.type === "warning"
                ? "bg-amber-600 hover:bg-amber-700 text-white shadow-md shadow-amber-200"
                : "bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-200"
            }`}
          >
            {notificationBanner.actionText}
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </motion.div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 1. USER IDENTITY & PROFILE COMPLETION */}
      {/* ------------------------------------------------------------- */}
      <Card className="shadow-lg border border-slate-200/80 bg-white rounded-3xl overflow-hidden">
        <CardHeader className="bg-slate-50/80 p-6 sm:p-8 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl font-bold text-slate-900 flex items-center gap-2.5">
              <UserIcon className="w-6 h-6 text-emerald-600" />
              User Information
            </CardTitle>

            <Button
              onClick={() => setShowEditProfileModal(true)}
              variant="outline"
              size="sm"
              className="rounded-2xl border-slate-300 text-slate-700 font-bold text-xs sm:text-sm px-4 py-2 hover:bg-slate-100"
            >
              <Edit3 className="w-4 h-4 mr-1.5 text-emerald-600" />
              Update Profile
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-6 sm:p-8 space-y-8">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
            <div className="relative shrink-0 group">
              <div className="w-24 h-24 rounded-3xl overflow-hidden shadow-md border-2 border-white bg-slate-900 flex items-center justify-center">
                <UserAvatar avatarId={user?.avatar_id} className="w-full h-full" />
              </div>

              {/* Edit Avatar Pencil Button */}
              <button
                type="button"
                onClick={() => {
                  setSelectedAvatarId(user?.avatar_id || "avatar_01");
                  setAvatarFeedback(null);
                  setShowAvatarModal(true);
                }}
                aria-label="Change profile avatar"
                title="Change profile avatar"
                className="absolute -bottom-1 -right-1 w-8 h-8 bg-slate-900 hover:bg-emerald-600 text-white rounded-full flex items-center justify-center shadow-lg border-2 border-white transition-colors cursor-pointer"
              >
                <Edit3 className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 text-center sm:text-left flex-grow">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                  {user?.full_name?.trim() || <span className="text-slate-400 italic">Not provided</span>}
                </h2>
                <Badge className={user?.full_name && user?.email ? "bg-emerald-100 text-emerald-800 border-emerald-200 text-xs font-bold px-3 py-1 rounded-xl" : "bg-slate-100 text-slate-600 text-xs px-3 py-1 rounded-xl"}>
                  {user?.full_name && user?.email ? "Verified Account" : "Unverified"}
                </Badge>
              </div>

              <p className="text-base font-semibold text-slate-700">
                <span className="font-bold text-slate-400 mr-2">Email:</span>
                {user?.email?.trim() || <span className="text-slate-400 italic">Not provided</span>}
              </p>

              <p className="text-base font-semibold text-slate-700">
                <span className="font-bold text-slate-400 mr-2">Phone:</span>
                {user?.phone?.trim() ? (
                  <span className="font-mono text-slate-900 font-bold">{user.phone}</span>
                ) : (
                  <span className="text-slate-400 italic">Not provided</span>
                )}
              </p>
            </div>
          </div>

          <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <span className="text-sm font-extrabold text-slate-900 uppercase tracking-wider">Profile Completion</span>
              <span className="text-base font-extrabold text-emerald-600">{profileCompletion.percentage}% complete</span>
            </div>

            <Progress value={profileCompletion.percentage} className="h-3 bg-slate-200 rounded-full" />

            <p className="text-xs font-medium text-slate-600 leading-relaxed">
              All required profile information has been provided ({profileCompletion.completedCount}/{profileCompletion.totalCount} fields complete).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------- */}
      {/* TRUSTED PLACES MANAGEMENT SECTION */}
      {/* ------------------------------------------------------------- */}
      <div className="space-y-6">
        {placeFeedback && (
          <div className={`p-4 rounded-2xl text-xs font-extrabold shadow-sm ${
            placeFeedback.type === "success"
              ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
              : "bg-rose-100 text-rose-800 border border-rose-300"
          }`}>
            {placeFeedback.message}
          </div>
        )}

        <TrustedPlacesSection
          trustedPlaces={trustedPlaces}
          loading={loading}
          selectedPlaceId={selectedTrustedPlace?.id}
          onSelectPlace={(place) => setSelectedTrustedPlace(place)}
          onAddClick={handleAddPlaceClick}
          onEditClick={handleEditPlaceClick}
          onDeleteClick={handleDeletePlace}
        />

        {selectedTrustedPlace && (
          <TrustedPlaceDetailsCard
            place={selectedTrustedPlace}
            onNavigate={() => handleNavigateToPlace(selectedTrustedPlace)}
            onEdit={() => handleEditPlaceClick(selectedTrustedPlace)}
            onDelete={() => handleDeletePlace(selectedTrustedPlace.id)}
          />
        )}
      </div>

      {/* ------------------------------------------------------------- */}
      {/* 2. TRUST SCORE & SCORE FACTORS BREAKDOWN */}
      {/* ------------------------------------------------------------- */}
      <Card className="shadow-lg border border-slate-200/80 bg-white rounded-3xl overflow-hidden">
        <CardHeader className="bg-slate-50/80 p-6 sm:p-8 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl font-bold text-slate-900 flex items-center gap-2.5">
              <Shield className="w-6 h-6 text-emerald-600" />
              Trust Score
            </CardTitle>

            <Badge className={`font-bold uppercase tracking-wider text-xs px-3 py-1.5 rounded-xl ${
              trustScoreObj.score >= 90
                ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                : trustScoreObj.score >= 75
                ? "bg-teal-100 text-teal-800 border-teal-300"
                : trustScoreObj.score >= 50
                ? "bg-amber-100 text-amber-800 border-amber-300"
                : "bg-rose-100 text-rose-800 border-rose-300"
            }`}>
              {trustScoreObj.label}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="p-6 sm:p-8 space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 p-6 rounded-2xl bg-gradient-to-r from-emerald-50/90 via-teal-50/60 to-slate-50 border border-emerald-200/60">
            <div>
              <p className="text-xs font-extrabold text-slate-500 uppercase tracking-widest">TRUST SCORE</p>
              <div className="text-4xl sm:text-5xl font-black text-slate-900 tracking-tight mt-1">
                {trustScoreObj.score}<span className="text-2xl text-slate-500 font-bold">/100</span>
              </div>
              <p className="text-sm font-bold text-emerald-700 mt-1.5">
                {trustScoreObj.label} Status
              </p>
              <p className="text-xs font-medium text-slate-600 mt-1">
                Based on your configured emergency-safety features.
              </p>
            </div>

            <div className="w-20 h-20 rounded-3xl bg-white border-2 border-emerald-500/30 flex items-center justify-center text-emerald-600 font-black text-2xl shadow-md shrink-0 self-center sm:self-auto">
              {trustScoreObj.score}
            </div>
          </div>

          <div className="space-y-2">
            <Progress value={trustScoreObj.score} className="h-3 bg-slate-200 rounded-full" />
            <p className="text-xs text-slate-500 text-right font-medium">100 points maximum</p>
          </div>

          <div className="space-y-4 pt-2 border-t border-slate-100">
            <h4 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider">Factors Breakdown</h4>
            
            <div className="grid sm:grid-cols-2 gap-3">
              {trustScoreObj.factors.map((factor) => (
                <div
                  key={factor.id}
                  className={`flex items-center justify-between p-3.5 rounded-2xl text-sm font-semibold border ${
                    factor.passed
                      ? "bg-emerald-50/70 border-emerald-200 text-emerald-950"
                      : "bg-slate-50 border-slate-200 text-slate-500"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {factor.passed ? (
                      <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                    ) : (
                      <XCircle className="w-5 h-5 text-slate-400 shrink-0" />
                    )}
                    <span>{factor.label}</span>
                  </div>

                  <span className={`font-bold font-mono text-base ${factor.passed ? "text-emerald-700" : "text-slate-400"}`}>
                    +{factor.points}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------- */}
      {/* 3. EMERGENCY CONTACT (PRIMARY DATA WITH GUARDIAN ROLE ASSIGNMENT) */}
      {/* ------------------------------------------------------------- */}
      <Card className="shadow-lg border border-slate-200/80 bg-white rounded-3xl overflow-hidden">
        <CardHeader className="bg-slate-50/80 p-6 sm:p-8 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl font-bold text-slate-900 flex items-center gap-2.5">
              <Phone className="w-6 h-6 text-blue-600" />
              Emergency Contact ({contacts.length})
            </CardTitle>

            <Button
              onClick={() => setShowAddContactModal(true)}
              size="sm"
              className="rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs sm:text-sm px-4 py-2 shadow-md shadow-blue-200"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Add Emergency Contact
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-6 sm:p-8">
          {contacts.length === 0 ? (
            <div className="text-center py-10 px-4 space-y-3 bg-slate-50/70 rounded-2xl border border-dashed border-slate-300">
              <div className="w-16 h-16 mx-auto rounded-3xl bg-blue-50 flex items-center justify-center text-blue-500">
                <Phone className="w-8 h-8" />
              </div>
              <h3 className="font-extrabold text-slate-900 text-lg">No emergency contact added</h3>
              <p className="text-sm font-medium text-slate-600 max-w-sm mx-auto">
                Add a trusted contact for SOS alerts so Safe Streets can reach them during an emergency.
              </p>
              <Button
                onClick={() => setShowAddContactModal(true)}
                variant="outline"
                className="rounded-2xl border-blue-300 text-blue-700 hover:bg-blue-50 font-bold text-sm px-6 py-2.5 mt-2"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Emergency Contact
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {contacts.map((contact) => {
                const isVerified = (contact.phone || contact.number || "").replace(/\D/g, "").length >= 10;
                const isGuardian = user?.safety_preferences?.guardian_contact_id === contact.id;

                return (
                  <div
                    key={contact.id}
                    className={`p-6 rounded-2xl border flex flex-col md:flex-row md:items-center justify-between gap-6 transition-all shadow-sm ${
                      isGuardian
                        ? "bg-purple-50/80 border-purple-200 shadow-purple-100"
                        : "bg-slate-50/90 border-slate-200 hover:bg-slate-100/80"
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className={`w-12 h-12 rounded-2xl text-white font-bold flex items-center justify-center text-xl shrink-0 shadow-sm mt-0.5 ${
                        isGuardian ? "bg-purple-600" : "bg-blue-600"
                      }`}>
                        {(contact.name || contact.full_name || "C").charAt(0).toUpperCase()}
                      </div>

                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <h3 className="font-extrabold text-slate-900 text-lg sm:text-xl">
                            {contact.name || contact.full_name}
                          </h3>

                          {/* Guardian Role Badge */}
                          {isGuardian && (
                            <Badge className="bg-purple-600 text-white border-purple-700 text-xs font-bold px-2.5 py-0.5 rounded-lg flex items-center gap-1">
                              <ShieldCheck className="w-3.5 h-3.5" />
                              Guardian ✓
                            </Badge>
                          )}

                          {contact.is_primary && (
                            <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-xs font-bold px-2.5 py-0.5 rounded-lg">
                              Primary Contact
                            </Badge>
                          )}

                          <Badge variant="outline" className="capitalize text-xs font-bold text-slate-700 px-2.5 py-0.5 rounded-lg border-slate-300">
                            {contact.relationship || "Contact"}
                          </Badge>
                        </div>

                        {/* HIGH READABILITY PHONE NUMBER */}
                        <p className="text-lg sm:text-xl font-mono font-extrabold text-slate-900 tracking-wide">
                          {contact.phone || contact.number}
                        </p>

                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold inline-flex items-center gap-1.5 ${isVerified ? "text-emerald-700" : "text-amber-700"}`}>
                            {isVerified ? <CheckCircle className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-amber-600" />}
                            {isVerified ? "Verified Contact ✓" : "Unverified Number"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* GUARDIAN ROLE TOGGLE & DELETE ACTIONS */}
                    <div className="flex items-center gap-3 self-end md:self-center">
                      {isGuardian ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSetGuardianRole(null)}
                          className="rounded-xl border-purple-300 text-purple-700 hover:bg-purple-100 font-bold text-xs px-4 py-2"
                        >
                          Remove Guardian Role
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSetGuardianRole(contact.id)}
                          className="rounded-xl border-slate-300 text-slate-700 hover:bg-purple-50 hover:text-purple-700 hover:border-purple-300 font-bold text-xs px-4 py-2"
                        >
                          Set as Guardian
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setContactToDelete(contact)}
                        className="text-rose-600 hover:text-rose-700 hover:bg-rose-100 rounded-xl px-3 py-2"
                      >
                        <Trash2 className="w-5 h-5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------- */}
      {/* 4. GUARDIAN NETWORK CARD (DERIVED FROM EMERGENCY CONTACT GUARDIAN ROLE) */}
      {/* ------------------------------------------------------------- */}
      <Card className="shadow-lg border border-slate-200/80 bg-white rounded-3xl overflow-hidden">
        <CardHeader className="bg-slate-50/80 p-6 sm:p-8 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl font-bold text-slate-900 flex items-center gap-2.5">
              <ShieldCheck className="w-6 h-6 text-purple-600" />
              Guardian Network
            </CardTitle>

            {contacts.length > 0 && !activeGuardianContact && (
              <Button
                onClick={() => {
                  setSelectedGuardianCandidateId(contacts[0]?.id || null);
                  setShowChooseGuardianModal(true);
                }}
                variant="outline"
                size="sm"
                className="rounded-2xl border-purple-300 text-purple-700 hover:bg-purple-50 font-bold text-xs sm:text-sm px-4 py-2"
              >
                Choose Guardian
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-6 sm:p-8">
          {activeGuardianContact ? (
            /* REQUIREMENT 3 & 9: ASSIGNED GUARDIAN DISPLAY */
            <div className="p-6 rounded-2xl bg-gradient-to-r from-purple-50 to-indigo-50/60 border border-purple-200 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-purple-600 text-white font-bold flex items-center justify-center text-2xl shrink-0 shadow-md">
                  {(activeGuardianContact.name || activeGuardianContact.full_name || "G").charAt(0).toUpperCase()}
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <h3 className="font-extrabold text-slate-900 text-lg sm:text-xl">
                      {activeGuardianContact.name || activeGuardianContact.full_name}
                    </h3>
                    <Badge className="bg-purple-600 text-white text-xs font-bold px-2.5 py-0.5 rounded-lg">
                      Guardian Connected
                    </Badge>
                  </div>

                  <p className="text-sm font-semibold text-slate-600 capitalize">
                    {activeGuardianContact.relationship || "Trusted Contact"}
                  </p>

                  <p className="text-lg font-mono font-extrabold text-purple-950">
                    {activeGuardianContact.phone || activeGuardianContact.number}
                  </p>
                </div>
              </div>

              <Button
                variant="outline"
                onClick={() => handleSetGuardianRole(null)}
                className="rounded-2xl border-purple-300 text-purple-700 hover:bg-purple-100 font-bold text-sm px-5 py-2.5 self-end md:self-center"
              >
                Remove Guardian Role
              </Button>
            </div>
          ) : contacts.length === 0 ? (
            /* REQUIREMENT 13: NO EMERGENCY CONTACTS EMPTY STATE */
            <div className="p-8 rounded-2xl bg-purple-50/50 border border-dashed border-purple-200 text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-3xl bg-purple-100 flex items-center justify-center text-purple-600">
                <Users className="w-8 h-8" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <h3 className="font-extrabold text-slate-900 text-lg">No guardian can be assigned yet</h3>
                <p className="text-sm font-medium text-slate-600 leading-relaxed">
                  Add an emergency contact first.
                </p>
              </div>
              <Button
                onClick={() => setShowAddContactModal(true)}
                className="rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm px-6 py-3 shadow-md shadow-purple-200"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Emergency Contact
              </Button>
            </div>
          ) : (
            /* REQUIREMENT 3 & 9: CONTACTS EXIST BUT NO GUARDIAN ASSIGNED YET */
            <div className="p-8 rounded-2xl bg-purple-50/60 border border-purple-200/80 text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-3xl bg-purple-100 flex items-center justify-center text-purple-600">
                <ShieldCheck className="w-8 h-8" />
              </div>

              <div className="space-y-1 max-w-md mx-auto">
                <h3 className="font-extrabold text-slate-900 text-lg">No guardian connected</h3>
                <p className="text-sm font-medium text-slate-600 leading-relaxed">
                  Choose one of your emergency contacts as your trusted guardian.
                </p>
              </div>

              <Button
                onClick={() => {
                  setSelectedGuardianCandidateId(contacts[0]?.id || null);
                  setShowChooseGuardianModal(true);
                }}
                className="rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm px-6 py-3 shadow-md shadow-purple-200"
              >
                Choose Guardian
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------- */}
      {/* 5. EMERGENCY PROTOCOLS & SAFETY SETTINGS */}
      {/* ------------------------------------------------------------- */}
      <Card className="shadow-lg border border-slate-200/80 bg-white rounded-3xl overflow-hidden">
        <CardHeader className="bg-slate-50/80 p-6 sm:p-8 border-b border-slate-100">
          <CardTitle className="text-xl font-bold text-slate-900 flex items-center gap-2.5">
            <Zap className="w-6 h-6 text-amber-500" />
            Emergency Protocols & Safety Settings
          </CardTitle>
        </CardHeader>

        <CardContent className="p-6 sm:p-8 space-y-4">
          <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <p className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">Emergency Contact</p>
              <p className="text-base font-extrabold text-slate-900 mt-1">
                {contacts.length > 0
                  ? `${contacts[0].name || contacts[0].full_name} (${contacts[0].phone || contacts[0].number})`
                  : "Not provided"}
              </p>
            </div>
            <Badge className={contacts.length > 0 ? "bg-emerald-100 text-emerald-800 text-xs font-bold px-3 py-1 self-start sm:self-auto" : "bg-slate-200 text-slate-700 text-xs font-bold px-3 py-1 self-start sm:self-auto"}>
              {contacts.length > 0 ? "Configured" : "Not provided"}
            </Badge>
          </div>

          <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <p className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">Guardian</p>
              <p className="text-base font-extrabold text-slate-900 mt-1">
                {activeGuardianContact
                  ? `${activeGuardianContact.name || activeGuardianContact.full_name} (${activeGuardianContact.phone || activeGuardianContact.number})`
                  : "No guardian connected"}
              </p>
            </div>
            <Badge className={activeGuardianContact ? "bg-purple-100 text-purple-800 text-xs font-bold px-3 py-1 self-start sm:self-auto" : "bg-slate-200 text-slate-700 text-xs font-bold px-3 py-1 self-start sm:self-auto"}>
              {activeGuardianContact ? "Connected" : "Not connected"}
            </Badge>
          </div>

          <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
            <div>
              <p className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">SOS Notifications</p>
              <p className="text-sm font-semibold text-slate-700 mt-1">
                {profileForm.sos_notifications ? "Enabled (+10 pts)" : "Disabled (+0 pts)"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleTogglePreference("sos_notifications")}
              className={`w-14 h-7 rounded-full transition-colors relative p-1 cursor-pointer shrink-0 ${
                profileForm.sos_notifications ? "bg-emerald-500" : "bg-slate-300"
              }`}
            >
              <div className={`w-5 h-5 rounded-full bg-white transition-transform shadow-sm ${
                profileForm.sos_notifications ? "translate-x-7" : "translate-x-0"
              }`} />
            </button>
          </div>

          <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
            <div>
              <p className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">Location Sharing</p>
              <p className="text-sm font-semibold text-slate-700 mt-1">
                {profileForm.auto_share_location ? "Enabled (+15 pts)" : "Disabled (+0 pts)"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleTogglePreference("auto_share_location")}
              className={`w-14 h-7 rounded-full transition-colors relative p-1 cursor-pointer shrink-0 ${
                profileForm.auto_share_location ? "bg-emerald-500" : "bg-slate-300"
              }`}
            >
              <div className={`w-5 h-5 rounded-full bg-white transition-transform shadow-sm ${
                profileForm.auto_share_location ? "translate-x-7" : "translate-x-0"
              }`} />
            </button>
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------- */}
      {/* MODAL 1: EDIT PROFILE MODAL */}
      {/* ------------------------------------------------------------- */}
      <AnimatePresence>
        {showEditProfileModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl space-y-6 border border-slate-100"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <h3 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
                  <UserIcon className="w-5 h-5 text-emerald-600" />
                  Update Profile Information
                </h3>
                <button
                  onClick={() => setShowEditProfileModal(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-xl"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="full_name" className="text-xs font-extrabold uppercase text-slate-700">Full Name</Label>
                  <Input
                    id="full_name"
                    value={profileForm.full_name}
                    onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })}
                    placeholder="Enter your full name"
                    className="h-12 rounded-2xl border-slate-300 font-semibold"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone" className="text-xs font-extrabold uppercase text-slate-700">Mobile Phone Number</Label>
                  <Input
                    id="phone"
                    value={profileForm.phone}
                    onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                    placeholder="Enter your mobile number"
                    className="h-12 rounded-2xl border-slate-300 font-semibold"
                  />
                </div>

                <div className="pt-4 flex gap-3 justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowEditProfileModal(false)}
                    className="rounded-2xl border-slate-300 font-bold px-5"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={saving}
                    className="rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 shadow-md shadow-emerald-200"
                  >
                    {saving ? "Saving..." : "Save Profile"}
                  </Button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------------- */}
      {/* MODAL 2: ADD EMERGENCY CONTACT MODAL */}
      {/* ------------------------------------------------------------- */}
      <AnimatePresence>
        {showAddContactModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl space-y-6 border border-slate-100"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <h3 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
                  <Phone className="w-5 h-5 text-blue-600" />
                  Add Emergency Contact
                </h3>
                <button
                  onClick={() => setShowAddContactModal(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-xl"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleAddContact} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="c_name" className="text-xs font-extrabold uppercase text-slate-700">Contact Name *</Label>
                  <Input
                    id="c_name"
                    required
                    value={contactForm.name}
                    onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                    placeholder="Full name of emergency contact"
                    className="h-12 rounded-2xl border-slate-300 font-semibold"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="c_phone" className="text-xs font-extrabold uppercase text-slate-700">Phone Number *</Label>
                  <Input
                    id="c_phone"
                    required
                    value={contactForm.phone}
                    onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                    placeholder="10-digit phone number"
                    className="h-12 rounded-2xl border-slate-300 font-semibold"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="c_email" className="text-xs font-extrabold uppercase text-slate-700">Email Address (Optional)</Label>
                  <Input
                    id="c_email"
                    type="email"
                    value={contactForm.email}
                    onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                    placeholder="contact@example.com"
                    className="h-12 rounded-2xl border-slate-300 font-semibold"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="c_rel" className="text-xs font-extrabold uppercase text-slate-700">Relationship</Label>
                  <Select
                    value={contactForm.relationship}
                    onValueChange={(val) => setContactForm({ ...contactForm, relationship: val })}
                  >
                    <SelectTrigger className="h-12 rounded-2xl border-slate-300 font-semibold">
                      <SelectValue placeholder="Select relationship" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="family">Family</SelectItem>
                      <SelectItem value="friend">Friend</SelectItem>
                      <SelectItem value="partner">Partner</SelectItem>
                      <SelectItem value="neighbor">Neighbor</SelectItem>
                      <SelectItem value="colleague">Colleague</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="pt-4 flex gap-3 justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowAddContactModal(false)}
                    className="rounded-2xl border-slate-300 font-bold px-5"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={saving}
                    className="rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 shadow-md shadow-blue-200"
                  >
                    {saving ? "Saving..." : "Save Contact"}
                  </Button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------------- */}
      {/* MODAL 3: CHOOSE GUARDIAN MODAL (SELECT FROM EXISTING CONTACTS) */}
      {/* ------------------------------------------------------------- */}
      <AnimatePresence>
        {showChooseGuardianModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl space-y-6 border border-slate-100"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <h3 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
                  <ShieldCheck className="w-6 h-6 text-purple-600" />
                  Choose a Guardian
                </h3>
                <button
                  onClick={() => setShowChooseGuardianModal(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-xl"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <p className="text-xs font-medium text-slate-600">
                Select one of your existing emergency contacts to assign them the Guardian role:
              </p>

              <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                {contacts.map((contact) => (
                  <label
                    key={contact.id}
                    onClick={() => setSelectedGuardianCandidateId(contact.id)}
                    className={`flex items-center justify-between p-4 rounded-2xl border cursor-pointer transition-all ${
                      selectedGuardianCandidateId === contact.id
                        ? "bg-purple-50 border-purple-400 ring-2 ring-purple-400/20"
                        : "bg-slate-50 border-slate-200 hover:bg-slate-100/80"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        selectedGuardianCandidateId === contact.id
                          ? "border-purple-600 bg-purple-600 text-white"
                          : "border-slate-400 bg-white"
                      }`}>
                        {selectedGuardianCandidateId === contact.id && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </div>

                      <div>
                        <p className="font-extrabold text-slate-900 text-sm">
                          {contact.name || contact.full_name}
                        </p>
                        <p className="text-xs font-semibold text-slate-500 capitalize">
                          {contact.relationship || "Contact"}
                        </p>
                      </div>
                    </div>

                    <span className="font-mono text-xs font-bold text-slate-700">
                      {contact.phone || contact.number}
                    </span>
                  </label>
                ))}
              </div>

              <div className="pt-2 flex gap-3 justify-end border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowChooseGuardianModal(false)}
                  className="rounded-2xl border-slate-300 font-bold px-5"
                >
                  Cancel
                </Button>
                <Button
                  disabled={!selectedGuardianCandidateId}
                  onClick={() => handleSetGuardianRole(selectedGuardianCandidateId)}
                  className="rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-bold px-6 shadow-md shadow-purple-200"
                >
                  Confirm Guardian
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------------- */}
      {/* MODAL 4: DELETE CONTACT CONFIRMATION MODAL */}
      {/* ------------------------------------------------------------- */}
      <AnimatePresence>
        {contactToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-slate-100 space-y-5"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-rose-100 flex items-center justify-center text-rose-600 shrink-0">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-extrabold text-lg text-slate-900">Delete Contact?</h3>
                  <p className="text-xs font-medium text-slate-500">Remove from emergency contact list</p>
                </div>
              </div>

              <p className="text-slate-700 text-sm font-medium leading-relaxed">
                Are you sure you want to delete <span className="font-bold text-slate-900">{contactToDelete.name || contactToDelete.full_name}</span> from your emergency contacts?
              </p>

              <div className="flex gap-3 pt-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setContactToDelete(null)}
                  className="rounded-2xl border-slate-300 font-bold px-5"
                >
                  Cancel
                </Button>
                <Button
                  onClick={confirmDeleteContact}
                  className="rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-bold px-6 shadow-md shadow-rose-200"
                >
                  Delete Contact
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------------- */}
      {/* MODAL 5: CHANGE PROFILE AVATAR MODAL */}
      {/* ------------------------------------------------------------- */}
      <AnimatePresence>
        {showAvatarModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-6 border border-slate-100"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <h3 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
                  <Camera className="w-5 h-5 text-emerald-600" />
                  Change Profile Avatar
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAvatarModal(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-xl"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {avatarFeedback && (
                <div className={`p-3 rounded-2xl text-xs font-extrabold ${
                  avatarFeedback.type === "success"
                    ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                    : "bg-rose-100 text-rose-800 border border-rose-300"
                }`}>
                  {avatarFeedback.message}
                </div>
              )}

              <p className="text-xs font-medium text-slate-600">
                Select an avatar for your Safe Streets account profile:
              </p>

              <div className="grid grid-cols-4 gap-3 max-h-64 overflow-y-auto p-1">
                {AVATAR_OPTIONS.map((avatarOption) => {
                  const isSelected = selectedAvatarId === avatarOption.id;
                  return (
                    <button
                      key={avatarOption.id}
                      type="button"
                      onClick={() => setSelectedAvatarId(avatarOption.id)}
                      title={avatarOption.name}
                      className={`relative w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden transition-all border-2 cursor-pointer p-0.5 ${
                        isSelected
                          ? "border-emerald-500 ring-4 ring-emerald-500/20 scale-105"
                          : "border-slate-200 hover:border-slate-400 opacity-80 hover:opacity-100"
                      }`}
                    >
                      <div className="w-full h-full rounded-xl overflow-hidden">
                        {avatarOption.render()}
                      </div>
                      {isSelected && (
                        <div className="absolute top-1 right-1 w-5 h-5 bg-emerald-500 text-white rounded-full flex items-center justify-center shadow">
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="pt-4 flex gap-3 justify-end border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAvatarModal(false)}
                  className="rounded-2xl border-slate-300 font-bold px-5"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={avatarSaving}
                  onClick={handleSaveAvatar}
                  className="rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 shadow-md shadow-emerald-200"
                >
                  {avatarSaving ? "Saving..." : "Save Avatar"}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------------- */}
      {/* MODAL 6: ADD / EDIT TRUSTED PLACE MODAL */}
      {/* ------------------------------------------------------------- */}
      <AddEditTrustedPlaceModal
        isOpen={isAddEditPlaceModalOpen}
        onClose={() => {
          setIsAddEditPlaceModalOpen(false);
          setEditingPlace(null);
        }}
        onSave={handleSavePlace}
        editingPlace={editingPlace}
      />
    </div>
  );
}
