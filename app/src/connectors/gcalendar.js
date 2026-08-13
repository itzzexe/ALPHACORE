// Google Calendar — meetings are where a deal stops being a row and becomes an
// appointment somebody has to keep.
import { wire, need } from './wire.js';

const API = 'https://www.googleapis.com/calendar/v3';

export default {
  id: 'gcalendar',
  label: 'Google Calendar',
  docs: 'https://developers.google.com/calendar/api',
  auth: { kind: 'oauth2', provider: 'google', scopes: ['https://www.googleapis.com/auth/calendar.events'] },
  capabilities: ['events.list', 'event.create', 'event.cancel', 'freebusy'],
  quotaDay: 300,
  ops: {
    'events.list': {
      run: ({ calendar = 'primary', days = 7, max = 25 }, ctx) => {
        const now = new Date();
        const end = new Date(Date.now() + days * 864e5);
        return wire(`${API}/calendars/${encodeURIComponent(calendar)}/events?timeMin=${now.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=${max}`, {
          headers: { authorization: `Bearer ${need(ctx, 'access token')}` }, service: 'calendar',
        }).then((r) => ({
          events: (r.items || []).map((e) => ({
            id: e.id, summary: e.summary, start: e.start?.dateTime || e.start?.date,
            end: e.end?.dateTime || e.end?.date, attendees: (e.attendees || []).map((a) => a.email), link: e.htmlLink,
          })),
        }));
      },
    },
    'event.create': {
      target: (a) => (Array.isArray(a.attendees) ? a.attendees[0] : a.attendees),
      run: ({ calendar = 'primary', summary, start, end, attendees = [], description = '' }, ctx) =>
        wire(`${API}/calendars/${encodeURIComponent(calendar)}/events?sendUpdates=all`, {
          method: 'POST', headers: { authorization: `Bearer ${need(ctx, 'access token')}` },
          body: {
            summary, description,
            start: { dateTime: start }, end: { dateTime: end },
            attendees: (Array.isArray(attendees) ? attendees : [attendees]).filter(Boolean).map((email) => ({ email })),
          },
          service: 'calendar',
        }).then((e) => ({ id: e.id, link: e.htmlLink, start: e.start?.dateTime })),
    },
    'event.cancel': {
      run: ({ calendar = 'primary', id }, ctx) => wire(`${API}/calendars/${encodeURIComponent(calendar)}/events/${id}?sendUpdates=all`, {
        method: 'DELETE', headers: { authorization: `Bearer ${need(ctx, 'access token')}` }, service: 'calendar',
      }).then(() => ({ cancelled: id })),
    },
    freebusy: {
      run: ({ emails = [], days = 3 }, ctx) => wire(`${API}/freeBusy`, {
        method: 'POST', headers: { authorization: `Bearer ${need(ctx, 'access token')}` },
        body: {
          timeMin: new Date().toISOString(),
          timeMax: new Date(Date.now() + days * 864e5).toISOString(),
          items: emails.map((id) => ({ id })),
        },
        service: 'calendar',
      }),
    },
  },
};
