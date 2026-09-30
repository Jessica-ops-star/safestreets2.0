import safetyReportsSeed from './safetyreports.json' with { type: 'json' };
import emergencyContactsSeed from './emergencycontact.json' with { type: 'json' };
import sosAlertSeed from './sosalert.json' with { type: 'json' };
import { supabase } from '../src/lib/supabase.js';
import { getCommunityReports, addCommunityReport, deleteCommunityReport } from '../services/supabaseService.js';

function readStore(key, seed) {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
    const initial = Array.isArray(seed) ? seed : [];
    localStorage.setItem(key, JSON.stringify(initial));
    return initial;
}

function writeStore(key, value) {
	localStorage.setItem(key, JSON.stringify(value));
}

function generateId(prefix) {
	return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

async function getAuthUserId() {
	try {
		const { data: { user } } = await supabase.auth.getUser();
		if (user?.id) return user.id;
		const { data: sessionData } = await supabase.auth.getSession();
		if (sessionData?.session?.user?.id) return sessionData.session.user.id;
		const localUser = localStorage.getItem('current_user');
		if (localUser) {
			const u = JSON.parse(localUser);
			if (u?.id && u.id !== 'me' && u.id !== 'guest') return u.id;
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Retrieve the latest stored location for a user from the user_locations Supabase table.
 */
export async function getLatestUserLocation(userId = null) {
	let uId = userId;
	if (!uId) {
		uId = await getAuthUserId();
	}
	if (!uId) return null;

	try {
		const { data, error } = await supabase
			.from('user_locations')
			.select('*')
			.eq('user_id', uId)
			.order('updated_at', { ascending: false })
			.limit(1);

		if (!error && Array.isArray(data) && data.length > 0) {
			const row = data[0];
			return {
				id: row.id,
				user_id: row.user_id,
				latitude: Number(row.latitude),
				longitude: Number(row.longitude),
				address: row.address || "",
				updated_at: row.updated_at
			};
		} else if (error) {
			console.warn("Error querying user_locations in Supabase:", error);
		}
	} catch (err) {
		console.warn("Exception querying user_locations in Supabase:", err);
	}

	return null;
}

/**
 * Create a new snapshot record in the sos_alerts table copying values from user_locations.
 */
export async function createSOSAlert(alertData) {
	const userId = await getAuthUserId();
	const now = new Date().toISOString();

	const lat = Number(alertData.latitude || 0);
	const lon = Number(alertData.longitude || 0);
	const addr = alertData.address || alertData.location || "Stored Location";

	let createdAlert = {
		id: generateId('alert'),
		user_id: userId || 'local',
		alert_type: alertData.alert_type || 'manual_sos',
		location: addr,
		address: addr,
		latitude: lat,
		longitude: lon,
		status: alertData.status || 'active',
		message: alertData.message || 'Emergency assistance needed',
		contacts_notified: alertData.contacts_notified || [],
		created_date: now,
		created_at: now
	};

	if (userId) {
		try {
			const fullPayload = {
				user_id: userId,
				latitude: lat,
				longitude: lon,
				address: addr,
				created_at: now
			};

			if (alertData.alert_type) fullPayload.alert_type = alertData.alert_type;
			if (alertData.location) fullPayload.location = alertData.location;
			if (alertData.message) fullPayload.message = alertData.message;
			if (alertData.status) fullPayload.status = alertData.status || 'active';

			const { data: inserted, error } = await supabase
				.from('sos_alerts')
				.insert(fullPayload)
				.select()
				.single();

			if (!error && inserted) {
				createdAlert = {
					...createdAlert,
					id: inserted.id,
					user_id: inserted.user_id,
					latitude: Number(inserted.latitude || lat),
					longitude: Number(inserted.longitude || lon),
					address: inserted.address || addr,
					created_at: inserted.created_at || now,
					created_date: inserted.created_at || now
				};
				console.log("SUCCESS: Created SOS alert snapshot in Supabase sos_alerts table:", inserted);
			} else if (error) {
				console.warn("Supabase sos_alerts insert error (trying minimal schema fallback):", error);
				
				const minPayload = {
					user_id: userId,
					latitude: lat,
					longitude: lon,
					created_at: now
				};

				const { data: minInserted, error: minErr } = await supabase
					.from('sos_alerts')
					.insert(minPayload)
					.select()
					.single();

				if (!minErr && minInserted) {
					createdAlert = {
						...createdAlert,
						id: minInserted.id,
						user_id: minInserted.user_id,
						latitude: Number(minInserted.latitude),
						longitude: Number(minInserted.longitude),
						created_at: minInserted.created_at,
						created_date: minInserted.created_at
					};
					console.log("SUCCESS: Created SOS alert in Supabase (minimal schema fallback):", minInserted);
				} else {
					console.error("Error creating SOS alert in Supabase:", minErr);
				}
			}
		} catch (err) {
			console.error("Failed to insert SOS alert into Supabase:", err);
		}
	}

	const items = readStore('sos_alerts', sosAlertSeed);
	items.unshift(createdAlert);
	writeStore('sos_alerts', items);

	return createdAlert;
}

/**
 * Execute the complete SOS workflow via Node.js Backend POST /api/sos:
 * Step 1: Retrieve authenticated user.
 * Step 2: Query latest location from user_locations table.
 * Step 3: Query emergency contact from emergency_contacts table.
 * Step 4: Create record in sos_alerts table.
 * Step 5: Generate Google Maps URL.
 * Step 6: Dispatch Exotel Voice Flow call (callEmergencyContact).
 */
export async function triggerSOS(alertType = 'manual_sos', message = '', contactsNotified = []) {
	const userId = await getAuthUserId();
	if (!userId) {
		throw new Error("User authentication required to trigger SOS.");
	}

	let token = null;
	try {
		const { data: sessionData } = await supabase.auth.getSession();
		token = sessionData?.session?.access_token || null;
	} catch {}

	try {
		const headers = { "Content-Type": "application/json" };
		if (token) {
			headers["Authorization"] = `Bearer ${token}`;
		}

		const response = await fetch("/api/sos", {
			method: "POST",
			headers,
			body: JSON.stringify({
				userId,
				alert_type: alertType,
				message,
				contactsNotified
			})
		});

		if (response.ok) {
			const resData = await response.json();
			if (resData.success) {
				console.log("Backend POST /api/sos executed successfully:", resData);

				const items = readStore('sos_alerts', sosAlertSeed);
				if (resData.alert) items.unshift(resData.alert);
				writeStore('sos_alerts', items);

				return {
					alert: resData.alert,
					location: resData.location || { latitude: resData.alert.latitude, longitude: resData.alert.longitude },
					googleMapsUrl: resData.googleMapsUrl,
					exotel: resData.exotel
				};
			} else {
				throw new Error(resData.error || "Backend failed to process SOS request.");
			}
		}
	} catch (backendErr) {
		console.warn("Backend /api/sos endpoint notice (using direct client database query fallback):", backendErr);
	}

	// Fallback client database execution
	const location = await getLatestUserLocation(userId);

	if (!location || location.latitude === undefined || location.longitude === undefined) {
		throw new Error("No location found in user_locations table. Please enable location tracking before sending SOS.");
	}

	const alertRecord = await createSOSAlert({
		user_id: userId,
		latitude: location.latitude,
		longitude: location.longitude,
		address: location.address || "Stored Location",
		alert_type: alertType,
		message: message || "Emergency assistance needed",
		contacts_notified: contactsNotified
	});

	return {
		alert: alertRecord,
		location,
		googleMapsUrl: `https://www.google.com/maps?q=${location.latitude},${location.longitude}`
	};
}

export const SafetyReport = {
	async list(order = '-created_date') {
		let supabaseReports = [];
		try {
			supabaseReports = await getCommunityReports();
			if (!Array.isArray(supabaseReports)) supabaseReports = [];
		} catch (err) {
			console.warn("Failed to fetch community reports from Supabase:", err);
		}

		const localItems = readStore('safety_reports', safetyReportsSeed);
		const dbMap = new Map();

		supabaseReports.forEach((item) => {
			if (item?.id) dbMap.set(item.id, item);
		});

		localItems.forEach((item) => {
			if (item?.id && !dbMap.has(item.id)) {
				dbMap.set(item.id, item);
			}
		});

		const merged = Array.from(dbMap.values());
		const getTime = (item) => {
			const raw = item?.created_date || item?.created_at || item?.timestamp;
			if (!raw) return 0;
			const d = new Date(raw);
			return isNaN(d.getTime()) ? 0 : d.getTime();
		};
		return merged.sort((a, b) => getTime(b) - getTime(a));
	},
	async create(data) {
		try {
			const created = await addCommunityReport(data);
			if (created) {
				return created;
			}
		} catch (err) {
			console.warn("Supabase report creation warning (persisting locally):", err);
		}
		const items = readStore('safety_reports', safetyReportsSeed);
		const now = new Date().toISOString();
		const newItem = {
			id: generateId('report'),
			created_date: now,
			created_at: now,
			...data
		};
		items.unshift(newItem);
		writeStore('safety_reports', items);
		return newItem;
	},
	async delete(id) {
		if (!id) return false;
		try {
			await deleteCommunityReport(id);
		} catch (err) {
			console.warn("Supabase report delete exception:", err);
		}
		const items = readStore('safety_reports', safetyReportsSeed);
		const filtered = items.filter((i) => i.id !== id);
		writeStore('safety_reports', filtered);
		return true;
	}
};

export const EmergencyContact = {
	clearCache() {
		try {
			localStorage.removeItem('emergency_contacts');
			sessionStorage.removeItem('emergency_contacts');
		} catch {}
	},

	async list() {
		const userId = await getAuthUserId();
		const localItems = readStore('emergency_contacts', emergencyContactsSeed);

		if (userId) {
			try {
				const { data, error } = await supabase
					.from('emergency_contacts')
					.select('*')
					.eq('user_id', userId)
					.order('created_at', { ascending: false });

				if (!error && Array.isArray(data)) {
					const dbMap = new Map();
					data.forEach((item) => {
						dbMap.set(item.id, {
							id: item.id,
							user_id: item.user_id,
							full_name: item.full_name || item.name || '',
							name: item.full_name || item.name || '',
							number: item.number || item.phone || '',
							phone: item.number || item.phone || '',
							email: item.email || '',
							relationship: item.relationship || 'other',
							preferred_language: item.preferred_language || 'en',
							is_primary: item.is_primary ?? false,
							notify_sms: item.notify_sms ?? true,
							notify_email: item.notify_email ?? true,
							created_at: item.created_at
						});
					});

					localItems.forEach((item) => {
						if (!dbMap.has(item.id)) {
							dbMap.set(item.id, item);
						}
					});

					return Array.from(dbMap.values());
				} else if (error) {
					console.warn("Supabase emergency_contacts read error:", error);
				}
			} catch (err) {
				console.warn("Supabase emergency_contacts exception:", err);
			}
		}

		return localItems;
	},

	async create(data) {
		const userId = await getAuthUserId();

		const fullName = data.full_name || data.name || '';
		const phoneNumber = data.number || data.phone || '';
		const email = data.email || '';
		const relationship = data.relationship || 'other';
		const preferredLanguage = data.preferred_language || 'en';

		let newContactItem = {
			id: generateId('contact'),
			user_id: userId || 'local',
			full_name: fullName,
			name: fullName,
			number: phoneNumber,
			phone: phoneNumber,
			email: email,
			relationship: relationship,
			preferred_language: preferredLanguage,
			is_primary: data.is_primary ?? false,
			notify_sms: data.notify_sms ?? true,
			notify_email: data.notify_email ?? true,
			created_at: new Date().toISOString()
		};

		if (userId) {
			try {
				const payload = {
					user_id: userId,
					full_name: fullName,
					number: phoneNumber,
					email: email,
					relationship: relationship,
					preferred_language: preferredLanguage
				};

				const { data: inserted, error } = await supabase
					.from('emergency_contacts')
					.insert(payload)
					.select()
					.single();

				if (!error && inserted) {
					newContactItem = {
						...newContactItem,
						id: inserted.id,
						user_id: inserted.user_id,
						full_name: inserted.full_name || fullName,
						name: inserted.full_name || fullName,
						number: inserted.number || phoneNumber,
						phone: inserted.number || phoneNumber,
						email: inserted.email || email,
						relationship: inserted.relationship || relationship,
						preferred_language: inserted.preferred_language || preferredLanguage,
						created_at: inserted.created_at || newContactItem.created_at
					};
				} else if (error) {
					console.warn("Supabase insert warning (persisting locally):", error);
				}
			} catch (err) {
				console.warn("Failed to insert emergency contact to Supabase:", err);
			}
		}

		const items = readStore('emergency_contacts', emergencyContactsSeed);
		items.unshift(newContactItem);
		writeStore('emergency_contacts', items);
		return newContactItem;
	},

	async update(id, updates) {
		const userId = await getAuthUserId();
		const fullName = updates.full_name || updates.name;
		const phoneNumber = updates.number || updates.phone;
		const email = updates.email;
		const relationship = updates.relationship;
		const isPrimary = updates.is_primary;
		const preferredLanguage = updates.preferred_language;

		if (userId && id) {
			try {
				const payload = {};
				if (fullName !== undefined) payload.full_name = fullName;
				if (phoneNumber !== undefined) payload.number = phoneNumber;
				if (email !== undefined) payload.email = email;
				if (relationship !== undefined) payload.relationship = relationship;
				if (isPrimary !== undefined) payload.is_primary = isPrimary;
				if (preferredLanguage !== undefined) payload.preferred_language = preferredLanguage;

				if (Object.keys(payload).length > 0) {
					const { error } = await supabase
						.from('emergency_contacts')
						.update(payload)
						.eq('id', id)
						.eq('user_id', userId);

					if (error) {
						console.warn("Supabase update error:", error);
					}
				}
			} catch (err) {
				console.warn("Supabase update error:", err);
			}
		}

		const items = readStore('emergency_contacts', emergencyContactsSeed);
		const idx = items.findIndex((i) => i.id === id);
		if (idx >= 0) {
			items[idx] = { ...items[idx], ...updates };
			if (fullName) { items[idx].full_name = fullName; items[idx].name = fullName; }
			if (phoneNumber) { items[idx].number = phoneNumber; items[idx].phone = phoneNumber; }
			writeStore('emergency_contacts', items);
			return items[idx];
		}
		return null;
	},

	async delete(id) {
		const userId = await getAuthUserId();

		if (userId && id) {
			try {
				const { error } = await supabase
					.from('emergency_contacts')
					.delete()
					.eq('id', id)
					.eq('user_id', userId);

				if (error) {
					console.warn("Supabase delete error:", error);
				}
			} catch (err) {
				console.warn("Supabase delete exception:", err);
			}
		}

		const items = readStore('emergency_contacts', emergencyContactsSeed);
		const filtered = items.filter((i) => i.id !== id);
		writeStore('emergency_contacts', filtered);
		return true;
	}
};

export const SOSAlert = {
	async list(order = '-created_date', limit = 10) {
		const userId = await getAuthUserId();
		const localItems = readStore('sos_alerts', sosAlertSeed);

		if (userId) {
			try {
				const { data, error } = await supabase
					.from('sos_alerts')
					.select('*')
					.eq('user_id', userId)
					.order('created_at', { ascending: false })
					.limit(limit);

				if (!error && Array.isArray(data)) {
					const dbMap = new Map();
					data.forEach((item) => {
						dbMap.set(item.id, {
							id: item.id,
							user_id: item.user_id,
							alert_type: item.alert_type || 'manual_sos',
							location: item.location || item.address || 'Current Location',
							address: item.address || item.location || 'Current Location',
							latitude: Number(item.latitude || 0),
							longitude: Number(item.longitude || 0),
							status: item.status || 'active',
							message: item.message || '',
							created_at: item.created_at || item.created_date,
							created_date: item.created_at || item.created_date || new Date().toISOString()
						});
					});

					localItems.forEach((item) => {
						if (!dbMap.has(item.id)) {
							dbMap.set(item.id, item);
						} else {
							const existing = dbMap.get(item.id);
							if (item.status) existing.status = item.status;
							if (item.resolved_at) existing.resolved_at = item.resolved_at;
						}
					});

					return Array.from(dbMap.values()).slice(0, limit);
				}
			} catch (err) {
				console.warn("Supabase sos_alerts read error:", err);
			}
		}

		return localItems.slice(0, limit);
	},

	async filter(query = {}, order = '-created_date', limit = 10) {
		const items = await this.list(order, 1000);
		const filtered = items.filter((i) => Object.entries(query).every(([k, v]) => i[k] === v));
		return filtered.slice(0, limit);
	},

	async create(data) {
		return createSOSAlert(data);
	},

	async update(id, updates) {
		const userId = await getAuthUserId();

		// Update local store so UI state updates immediately and resolves active alert
		const items = readStore('sos_alerts', sosAlertSeed);
		const idx = items.findIndex((i) => i.id === id);
		let updatedItem = null;
		if (idx >= 0) {
			items[idx] = { ...items[idx], ...updates };
			writeStore('sos_alerts', items);
			updatedItem = items[idx];
		} else {
			updatedItem = { id, ...updates };
		}

		if (userId && id) {
			try {
				// Supabase sos_alerts table contains (id, user_id, latitude, longitude, created_at).
				// Only send database columns to Supabase to prevent HTTP 400 (PGRST204) schema errors for non-existent columns (status/resolved_at).
				const payload = {};
				if (updates.latitude !== undefined) payload.latitude = updates.latitude;
				if (updates.longitude !== undefined) payload.longitude = updates.longitude;
				if (updates.address !== undefined) payload.address = updates.address;
				if (updates.location !== undefined) payload.location = updates.location;

				if (Object.keys(payload).length > 0) {
					const { error } = await supabase
						.from('sos_alerts')
						.update(payload)
						.eq('id', id)
						.eq('user_id', userId);

					if (error) {
						console.warn("Supabase sos_alerts update notice:", error.message);
					}
				}
			} catch (err) {
				console.warn("Failed to update SOS alert in Supabase:", err);
			}
		}

		return updatedItem;
	}
};

export const User = {
	async me() {
		const raw = localStorage.getItem('current_user');
		if (raw) {
			try { return JSON.parse(raw); } catch {}
		}
		return null;
	},
	async updateMyUserData(updates) {
		const current = (await this.me()) || {};
		const merged = { ...current, ...updates, isAuthenticated: true };
		localStorage.setItem('current_user', JSON.stringify(merged));
		return merged;
	},
	async logout() {
		EmergencyContact.clearCache();
		localStorage.removeItem('current_user');
		localStorage.removeItem('emergency_contacts');
		sessionStorage.removeItem('emergency_contacts');
	},
	isAuthenticated() {
		const raw = localStorage.getItem('current_user');
		if (!raw) return false;
		try {
			const u = JSON.parse(raw);
			return !!u && (u.isAuthenticated === true || (!!u.id && u.id !== 'guest'));
		} catch {
			return false;
		}
	}
};
