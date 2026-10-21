/**
 * Time and Timezone Utilities
 *
 * This module provides utilities for handling timestamps and timezones
 * consistently across the application.
 */

export const sortSchedulesByTime = (schedules = []) => {
  const minutes = (schedule) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(schedule.time || "");
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return Infinity;
    return Number(match[1]) * 60 + Number(match[2]);
  };

  return schedules
    .map((schedule, index) => ({ schedule, index }))
    .sort((first, second) => (minutes(first.schedule) - minutes(second.schedule)) || first.index - second.index);
};

export const getUpcomingSchedules = (schedules = [], jobs = [], now = Date.now()) => {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  return schedules
    .map((schedule, index) => ({
      schedule,
      index,
      nextRun: jobsById.get(`posterizarr_${schedule.mode || "normal"}_${index}`)?.next_run,
    }))
    .filter(({ nextRun }) => nextRun && new Date(nextRun).getTime() >= now)
    .sort((first, second) => new Date(first.nextRun) - new Date(second.nextRun) || first.index - second.index);
};

/**
 * Get the browser's current timezone
 * @returns {string} IANA timezone identifier (e.g., "Europe/Berlin", "America/New_York")
 */
export const getBrowserTimezone = () => {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
};

/**
 * Parse a date string in multiple formats
 * Supports: ISO format, German format (DD.MM.YYYY HH:MM:SS)
 *
 * @param {string} dateStr - The date string to parse
 * @returns {Date|null} Parsed Date object or null if invalid
 */
export const parseDateTime = (dateStr) => {
  if (!dateStr) return null;

  // Try ISO format first
  let date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date;
  }

  // Try German format: "19.10.2025 05:14:22"
  const germanFormat = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/;
  const match = dateStr.match(germanFormat);
  if (match) {
    const [, day, month, year, hour, minute, second] = match;
    date = new Date(year, month - 1, day, hour, minute, second);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
};

/**
 * Format a date/time in a specific timezone
 * Uses sv-SE locale for consistent YYYY-MM-DD HH:MM:SS format
 *
 * @param {string|Date} isoString - ISO date string or Date object
 * @param {string} timezone - IANA timezone identifier (e.g., "Europe/Berlin")
 * @param {string} fallback - Fallback text if date is invalid (default: "Never")
 * @returns {string} Formatted date string or fallback
 */
export const formatDateTimeInTimezone = (
  isoString,
  timezone = "Europe/Berlin",
  fallback = "Never"
) => {
  if (!isoString) return fallback;

  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return fallback;

    return date
      .toLocaleString("sv-SE", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: timezone,
      })
      .replace(",", "");
  } catch (error) {
    console.error("Error formatting date in timezone:", error);
    return fallback;
  }
};

/**
 * Format a date to the browser's locale
 *
 * @param {Date|string} date - Date object or date string
 * @param {Object} options - Intl.DateTimeFormat options
 * @param {string} timezone - Optional timezone (defaults to browser timezone)
 * @returns {string} Formatted date string
 */
export const formatDateToLocale = (date, options = {}, timezone = null) => {
  if (!date) return "N/A";

  const dateObj = date instanceof Date ? date : parseDateTime(date);
  if (!dateObj || isNaN(dateObj.getTime())) return "N/A";

  // If timezone is provided, use formatDateTimeInTimezone for consistency
  if (timezone) {
    return formatDateTimeInTimezone(dateObj, timezone, "N/A");
  }

  // Otherwise, format as yyyy-mm-dd HH:mm:ss in browser timezone
  return dateObj
    .toLocaleString("sv-SE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      ...options,
    })
    .replace(",", "");
};

/**
 * Format a date with timezone info
 * Shows both the formatted date and the timezone abbreviation
 *
 * @param {Date|string} date - Date object or date string
 * @param {boolean} showTimezone - Whether to append timezone abbreviation
 * @returns {string} Formatted date string with optional timezone
 */
export const formatDateWithTimezone = (date, showTimezone = false) => {
  if (!date) return "N/A";

  const dateObj = date instanceof Date ? date : parseDateTime(date);
  if (!dateObj || isNaN(dateObj.getTime())) return "N/A";

  const formatted = formatDateToLocale(dateObj);

  if (showTimezone) {
    const tzAbbr = dateObj
      .toLocaleTimeString(undefined, {
        timeZoneName: "short",
      })
      .split(" ")
      .pop();
    return `${formatted} ${tzAbbr}`;
  }

  return formatted;
};

/**
 * Get timezone offset in hours
 *
 * @param {string} timezone - IANA timezone identifier
 * @returns {string} Offset string (e.g., "UTC+1", "UTC-5")
 */
export const getTimezoneOffset = (timezone = null) => {
  try {
    const tz = timezone || getBrowserTimezone();
    const now = new Date();

    // Format date in target timezone
    const tzDate = new Date(now.toLocaleString("en-US", { timeZone: tz }));

    // Format date in UTC
    const utcDate = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));

    // Calculate offset in hours
    const offset = (tzDate - utcDate) / (1000 * 60 * 60);

    if (offset === 0) return "UTC";

    const sign = offset > 0 ? "+" : "";
    return `UTC${sign}${offset}`;
  } catch (error) {
    console.error("Error calculating timezone offset:", error);
    return "UTC";
  }
};

/**
 * Check if browser timezone differs from scheduler timezone
 *
 * @param {string} schedulerTimezone - The timezone configured in the scheduler
 * @returns {boolean} True if timezones differ
 */
export const isTimezoneDifferent = (schedulerTimezone) => {
  const browserTz = getBrowserTimezone();
  return schedulerTimezone && browserTz !== schedulerTimezone;
};

/**
 * Format a timestamp for display with timezone awareness
 * If browser timezone differs from scheduler timezone, shows both
 *
 * @param {Date|string} date - Date object or date string
 * @param {string} schedulerTimezone - The timezone configured in the scheduler
 * @param {boolean} alwaysShowTz - Always show timezone info even if same
 * @returns {Object} Object with formatted date and optional timezone info
 */
export const formatTimestampWithTzInfo = (
  date,
  schedulerTimezone = null,
  alwaysShowTz = false
) => {
  if (!date) {
    return {
      formatted: "N/A",
      showTzWarning: false,
      browserTz: null,
      schedulerTz: null,
    };
  }

  const dateObj = date instanceof Date ? date : parseDateTime(date);
  if (!dateObj || isNaN(dateObj.getTime())) {
    return {
      formatted: "N/A",
      showTzWarning: false,
      browserTz: null,
      schedulerTz: null,
    };
  }

  const browserTz = getBrowserTimezone();
  const showTzWarning = isTimezoneDifferent(schedulerTimezone) || alwaysShowTz;

  return {
    formatted: formatDateToLocale(dateObj),
    showTzWarning,
    browserTz,
    schedulerTz: schedulerTimezone,
    browserOffset: getTimezoneOffset(browserTz),
    schedulerOffset: schedulerTimezone
      ? getTimezoneOffset(schedulerTimezone)
      : null,
  };
};

/**
 * Convert a time string (HH:MM) to a specific date in browser timezone
 * Useful for displaying scheduled times
 *
 * @param {string} timeStr - Time string in HH:MM format
 * @param {string} schedulerTimezone - Source timezone
 * @returns {string} Formatted time in browser timezone
 */
export const convertScheduledTimeToLocal = (
  timeStr,
  schedulerTimezone = null
) => {
  if (!timeStr) return "N/A";

  try {
    const [hours, minutes] = timeStr.split(":").map(Number);

    // Create a date object for today in the scheduler timezone
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const day = now.getDate();

    // If we have a scheduler timezone and it differs from browser
    if (schedulerTimezone && isTimezoneDifferent(schedulerTimezone)) {
      // Create date string in scheduler timezone
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(
        day
      ).padStart(2, "0")}T${String(hours).padStart(2, "0")}:${String(
        minutes
      ).padStart(2, "0")}:00`;

      // Parse as if in scheduler timezone (approximation)
      // Note: This is a simplified conversion. For exact conversion, we'd need a library like date-fns-tz
      const date = new Date(dateStr);
      return formatDateToLocale(date, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    }

    // Same timezone or no conversion needed
    return timeStr;
  } catch (error) {
    console.error("Error converting scheduled time:", error);
    return timeStr;
  }
};
