import React, { useState } from "react";
import { EmergencyContact } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Users, 
  Plus,
  Phone,
  Mail,
  Trash2,
  UserPlus,
  Star,
  AlertTriangle,
  Pencil,
  Globe
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function EmergencyContacts({ contacts, loading, onContactsChange }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [contactToDelete, setContactToDelete] = useState(null);
  const [editingContact, setEditingContact] = useState(null);
  const [newContact, setNewContact] = useState({
    name: "",
    phone: "",
    email: "",
    relationship: "",
    preferred_language: "en",
    is_primary: false,
    notify_sms: true,
    notify_email: true
  });

  const handleAddContact = async () => {
    const name = newContact.name?.trim();
    const phone = newContact.phone?.trim();
    if (!name || !phone) return;
    
    try {
      const contactToSave = {
        ...newContact,
        name,
        phone,
        full_name: name,
        number: phone,
        relationship: newContact.relationship || "other",
        preferred_language: newContact.preferred_language || "en"
      };
      await EmergencyContact.create(contactToSave);
      EmergencyContact.clearCache();
      setNewContact({
        name: "",
        phone: "",
        email: "",
        relationship: "",
        preferred_language: "en",
        is_primary: false,
        notify_sms: true,
        notify_email: true
      });
      setShowAddForm(false);
      if (onContactsChange) {
        await onContactsChange();
      }
    } catch (error) {
      console.error("Error adding contact:", error);
    }
  };

  const handleStartEdit = (contact) => {
    setEditingContact({
      id: contact.id,
      name: contact.name || contact.full_name || "",
      phone: contact.phone || contact.number || "",
      email: contact.email || "",
      relationship: contact.relationship || "other",
      preferred_language: contact.preferred_language || "en",
      is_primary: contact.is_primary || false
    });
  };

  const handleSaveEdit = async () => {
    if (!editingContact) return;
    const name = editingContact.name?.trim();
    const phone = editingContact.phone?.trim();
    if (!name || !phone) return;

    try {
      const contactToUpdate = {
        name,
        phone,
        full_name: name,
        number: phone,
        email: editingContact.email?.trim() || "",
        relationship: editingContact.relationship || "other",
        preferred_language: editingContact.preferred_language || "en"
      };
      await EmergencyContact.update(editingContact.id, contactToUpdate);
      EmergencyContact.clearCache();
      setEditingContact(null);
      if (onContactsChange) {
        await onContactsChange();
      }
    } catch (error) {
      console.error("Error updating contact:", error);
    }
  };

  const confirmDeleteContact = async () => {
    if (!contactToDelete) return;
    try {
      await EmergencyContact.delete(contactToDelete.id);
      setContactToDelete(null);
      onContactsChange();
    } catch (error) {
      console.error("Error deleting contact:", error);
    }
  };

  const handleSetPrimary = async (contactId) => {
    try {
      // First, set all contacts to not primary
      await Promise.all(
        contacts.map(contact => 
          EmergencyContact.update(contact.id, { is_primary: false })
        )
      );
      
      // Then set the selected contact as primary
      await EmergencyContact.update(contactId, { is_primary: true });
      onContactsChange();
    } catch (error) {
      console.error("Error setting primary contact:", error);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
    >
      <Card className="shadow-lg border-0 bg-white/80 backdrop-blur-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-500" />
              Emergency Contacts ({contacts.length})
            </CardTitle>
            <Button
              onClick={() => setShowAddForm(!showAddForm)}
              variant="outline"
              size="sm"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Contact
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add Contact Form */}
          {showAddForm && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="border rounded-lg p-4 bg-slate-50"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="name">Full Name</Label>
                  <Input
                    id="name"
                    value={newContact.name}
                    onChange={(e) => setNewContact({...newContact, name: e.target.value})}
                    placeholder="Enter full name"
                  />
                </div>
                <div>
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    value={newContact.phone}
                    onChange={(e) => setNewContact({...newContact, phone: e.target.value})}
                    placeholder="Enter phone number"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    value={newContact.email}
                    onChange={(e) => setNewContact({...newContact, email: e.target.value})}
                    placeholder="Enter email address"
                  />
                </div>
                <div>
                  <Label htmlFor="relationship">Relationship</Label>
                  <Select
                    value={newContact.relationship}
                    onValueChange={(value) => setNewContact({...newContact, relationship: value})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select relationship" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="family">Family</SelectItem>
                      <SelectItem value="friend">Friend</SelectItem>
                      <SelectItem value="partner">Partner</SelectItem>
                      <SelectItem value="colleague">Colleague</SelectItem>
                      <SelectItem value="neighbor">Neighbor</SelectItem>
                      <SelectItem value="doctor">Doctor</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="add-language">Preferred Alert Language</Label>
                  <Select
                    value={newContact.preferred_language || "en"}
                    onValueChange={(value) => setNewContact({...newContact, preferred_language: value})}
                  >
                    <SelectTrigger id="add-language">
                      <SelectValue placeholder="Select language" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="ta">Tamil</SelectItem>
                      <SelectItem value="hi">Hindi</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <Button onClick={handleAddContact} className="bg-blue-600 hover:bg-blue-700">
                  <UserPlus className="w-4 h-4 mr-2" />
                  Add Contact
                </Button>
                <Button variant="outline" onClick={() => setShowAddForm(false)}>
                  Cancel
                </Button>
              </div>
            </motion.div>
          )}

          {/* Contacts List */}
          {loading ? (
            <div className="space-y-3">
              {Array(3).fill(0).map((_, i) => (
                <div key={i} className="border rounded-lg p-4 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          ) : contacts.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <Users className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p>No emergency contacts added yet</p>
              <p className="text-sm">Add at least one contact for emergency alerts</p>
            </div>
          ) : (
            <div className="space-y-3">
              {contacts.map((contact) => (
                <motion.div
                  key={contact.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="border rounded-lg p-4 hover:shadow-md transition-shadow duration-200"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                        <span className="text-sm font-semibold text-blue-600">
                          {contact.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-slate-900">{contact.name}</h4>
                          {contact.is_primary && (
                            <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">
                              <Star className="w-3 h-3 mr-1" />
                              Primary
                            </Badge>
                          )}
                          <Badge variant="outline" className="capitalize">
                            {contact.relationship}
                          </Badge>
                          <Badge variant="outline" className="text-slate-600 border-slate-200 gap-1 bg-slate-50">
                            <Globe className="w-3 h-3 text-slate-400" />
                            {contact.preferred_language === "ta" ? "Tamil" : contact.preferred_language === "hi" ? "Hindi" : "English"}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600 mt-1">
                          <span className="flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            {contact.phone}
                          </span>
                          {contact.email && (
                            <span className="flex items-center gap-1">
                              <Mail className="w-3 h-3 text-slate-400" />
                              {contact.email}
                            </span>
                          )}
                          <div className="flex gap-2">
                            {contact.notify_sms && (
                              <Badge variant="outline" className="text-xs">SMS</Badge>
                            )}
                            {contact.notify_email && (
                              <Badge variant="outline" className="text-xs">Email</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleStartEdit(contact)}
                        title="Edit Contact"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      {!contact.is_primary && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSetPrimary(contact.id)}
                          title="Set as Primary"
                        >
                          <Star className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setContactToDelete(contact)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        title="Delete Contact"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Contact Modal */}
      <AnimatePresence>
        {editingContact && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-100 space-y-4"
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <h3 className="font-bold text-lg text-slate-900">Edit Emergency Contact</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingContact(null)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  ✕
                </Button>
              </div>

              <div className="space-y-3">
                <div>
                  <Label htmlFor="edit-name">Full Name</Label>
                  <Input
                    id="edit-name"
                    value={editingContact.name}
                    onChange={(e) => setEditingContact({ ...editingContact, name: e.target.value })}
                    placeholder="Enter full name"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-phone">Phone Number</Label>
                  <Input
                    id="edit-phone"
                    value={editingContact.phone}
                    onChange={(e) => setEditingContact({ ...editingContact, phone: e.target.value })}
                    placeholder="Enter phone number"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-email">Email Address</Label>
                  <Input
                    id="edit-email"
                    type="email"
                    value={editingContact.email}
                    onChange={(e) => setEditingContact({ ...editingContact, email: e.target.value })}
                    placeholder="Enter email address"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-relationship">Relationship</Label>
                  <Select
                    value={editingContact.relationship}
                    onValueChange={(value) => setEditingContact({ ...editingContact, relationship: value })}
                  >
                    <SelectTrigger id="edit-relationship">
                      <SelectValue placeholder="Select relationship" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="family">Family</SelectItem>
                      <SelectItem value="friend">Friend</SelectItem>
                      <SelectItem value="partner">Partner</SelectItem>
                      <SelectItem value="colleague">Colleague</SelectItem>
                      <SelectItem value="neighbor">Neighbor</SelectItem>
                      <SelectItem value="doctor">Doctor</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="edit-language">Preferred Alert Language</Label>
                  <Select
                    value={editingContact.preferred_language || "en"}
                    onValueChange={(value) => setEditingContact({ ...editingContact, preferred_language: value })}
                  >
                    <SelectTrigger id="edit-language">
                      <SelectValue placeholder="Select language" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="ta">Tamil</SelectItem>
                      <SelectItem value="hi">Hindi</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex gap-3 pt-3 justify-end border-t border-slate-100">
                <Button
                  variant="outline"
                  onClick={() => setEditingContact(null)}
                  className="border-slate-200 hover:bg-slate-100"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveEdit}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-md shadow-blue-200"
                >
                  Save Changes
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {contactToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-100 space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-slate-900">Delete Contact?</h3>
                  <p className="text-sm text-slate-500">This action cannot be undone.</p>
                </div>
              </div>

              <p className="text-slate-600 text-sm">
                Are you sure you really want to delete <span className="font-semibold text-slate-900">{contactToDelete.name}</span> from your emergency contacts?
              </p>

              <div className="flex gap-3 pt-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setContactToDelete(null)}
                  className="border-slate-200 hover:bg-slate-100"
                >
                  Cancel
                </Button>
                <Button
                  onClick={confirmDeleteContact}
                  className="bg-red-600 hover:bg-red-700 text-white font-medium shadow-md shadow-red-200"
                >
                  Yes, Delete
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}