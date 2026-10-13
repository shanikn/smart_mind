import WidgetKit
import SwiftUI

// Opens the app on an empty new note (App.tsx linking: smartmind://new-note).
private let newNoteURL = URL(string: "smartmind://new-note")!

// The widget never changes, so one entry and no refreshes.
struct NewNoteEntry: TimelineEntry {
    let date: Date
}

struct NewNoteProvider: TimelineProvider {
    func placeholder(in context: Context) -> NewNoteEntry {
        NewNoteEntry(date: .now)
    }

    func getSnapshot(in context: Context, completion: @escaping (NewNoteEntry) -> Void) {
        completion(NewNoteEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NewNoteEntry>) -> Void) {
        completion(Timeline(entries: [NewNoteEntry(date: .now)], policy: .never))
    }
}

struct NewNoteView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .accessoryCircular:
            // lock screen: the system tints it, so an SF Symbol, not the icon
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "square.and.pencil")
                    .font(.system(size: 22, weight: .semibold))
            }
            .accessibilityLabel("New note")
            .containerBackground(for: .widget) { Color.clear }
        default:
            VStack(alignment: .leading, spacing: 0) {
                Image("appIcon")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 48, height: 48)
                    .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                    .accessibilityHidden(true)
                Spacer(minLength: 0)
                HStack(spacing: 6) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(Color.accentColor)
                    Text("New note")
                        .font(.system(size: 17, weight: .bold, design: .rounded))
                        .foregroundStyle(Color("widgetText"))
                }
                .accessibilityElement(children: .combine)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .containerBackground(for: .widget) { Color("widgetBackground") }
        }
    }
}

struct NewNoteWidget: Widget {
    let kind: String = "NewNoteWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NewNoteProvider()) { _ in
            NewNoteView()
                .widgetURL(newNoteURL)
        }
        .configurationDisplayName("New note")
        .description("Start a new note in Smart Mind.")
        .supportedFamilies([.systemSmall, .accessoryCircular])
    }
}

#Preview(as: .systemSmall) {
    NewNoteWidget()
} timeline: {
    NewNoteEntry(date: .now)
}

#Preview(as: .accessoryCircular) {
    NewNoteWidget()
} timeline: {
    NewNoteEntry(date: .now)
}
