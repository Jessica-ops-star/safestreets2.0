import React, { useEffect, useState, useRef } from "react";
import { Input } from "@/components/ui/input.jsx";
import { searchAddress } from "../../services/geocoding";
import { Locate } from "lucide-react";

export default function SearchBox({
  label,
  value,
  onChange,
  onSelect,
  placeholder = "Search address",
  headerRight,
  onSelectLive,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const suppressSearchRef = useRef(false);

  useEffect(() => {
    let active = true;

    // Suppress re-searching immediately after user selects a suggestion item
    if (suppressSearchRef.current) {
      suppressSearchRef.current = false;
      setSuggestions([]);
      setLoading(false);
      return;
    }

    const fetchSuggestions = async () => {
      if (!value || value.trim().length < 2) {
        setSuggestions([]);
        return;
      }
      setLoading(true);
      const results = await searchAddress(value.trim());
      if (active) {
        setSuggestions(results || []);
        setLoading(false);
      }
    };

    const timeout = setTimeout(fetchSuggestions, 250);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [value]);

  const handleInputChange = (e) => {
    suppressSearchRef.current = false;
    onChange(e.target.value);
  };

  const handleSelectSuggestion = (item) => {
    suppressSearchRef.current = true;
    setSuggestions([]);
    setIsFocused(false);
    onSelect({
      label: item.display_name,
      coords: [parseFloat(item.lat), parseFloat(item.lon)],
      isCoordinates: item.isCoordinates || false,
      precision: item.precision || "street",
      precisionLabel: item.precisionLabel || "Destination found at street level",
      rawItem: item
    });
  };

  const handleSelectLiveLocation = () => {
    suppressSearchRef.current = true;
    setSuggestions([]);
    setIsFocused(false);
    if (onSelectLive) onSelectLive();
  };

  const showDropdown = isFocused && (suggestions.length > 0 || (onSelectLive && !value));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        {label && <label className="text-sm font-semibold text-slate-700">{label}</label>}
        {headerRight}
      </div>
      <div className="relative">
        <Input
          value={value}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          onChange={handleInputChange}
          onKeyDown={(e) => {
            if (e.key === "Enter" && suggestions.length > 0) {
              e.preventDefault();
              handleSelectSuggestion(suggestions[0]);
            }
          }}
          placeholder={placeholder}
        />
        {loading && <div className="absolute right-3 top-2.5 text-xs text-slate-400 animate-pulse">Searching...</div>}
      </div>
      {showDropdown && (
        <div className="border border-slate-200 rounded-xl shadow-lg divide-y divide-slate-100 max-h-56 overflow-auto bg-white/95 backdrop-blur-md z-50 relative">
          {onSelectLive && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelectLiveLocation();
              }}
              onClick={handleSelectLiveLocation}
              className="w-full text-left px-3.5 py-2.5 text-sm font-semibold text-blue-600 hover:bg-blue-50 flex items-center gap-2 transition-colors border-b border-slate-100 cursor-pointer"
            >
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-600"></span>
              </span>
              Use Current Live Location
            </button>
          )}
          {suggestions.map((item, idx) => (
            <button
              key={`${item.place_id || idx}`}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelectSuggestion(item);
              }}
              onClick={() => handleSelectSuggestion(item)}
              className="w-full text-left px-3.5 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-between gap-2"
            >
              <span className="truncate">{item.display_name}</span>
              {item.isCoordinates ? (
                <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded-full shrink-0">
                  Coordinates
                </span>
              ) : item.precision === "exact" ? (
                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full shrink-0">
                  Exact Address
                </span>
              ) : item.precision === "street" ? (
                <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded-full shrink-0">
                  Street Level
                </span>
              ) : (
                <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full shrink-0">
                  Area Level
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
