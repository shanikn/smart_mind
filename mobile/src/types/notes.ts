// defines how a note looks like

//  like note_to_dict
export interface Note {
    _id: string;
    content: string;
    created_at: string;
    // last change by the user; null or missing when never edited (or an older backend)
    edited_at?: string | null;
    category: string;
    contexts: string[];
    list_name: string;
    shown_count: number;
    dismissed_count: number;
    useful_count: number;
    never_show: boolean;
    last_shown: string | null;
    cooldown_until: string | null;
    reminders_enabled: boolean;
    category_explicit: boolean;
    location_explicit: boolean;
    location_value: string | null;
    remind_date_explicit: boolean;
    remind_time_explicit: boolean;
    remind_at_hour: number | null;
    remind_at_minute: number | null;
    remind_on_date: string | null;
    user_id: string | null;
    // from GET /notes/: where the reminder time comes from; only explicit and
    // text times get an exact alarm. Missing on an older backend.
    reminder_time_source?: "explicit" | "text" | "default" | null;
    // from GET /notes/: for an errand, which kind of store it needs
    // ("supermarket" | "pharmacy" | "post_office"). Missing on an older backend.
    store_type?: string | null;
}
