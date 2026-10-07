import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool } from "../../api/src/db/pool";
import { connectBrowser, renderApp, reseed } from "./harness";

const WAIT = { timeout: 20_000 };
beforeEach(async () => { cleanup(); await reseed(); });
afterAll(closePool);

async function open(email: string, path: string) {
  const b = connectBrowser();
  await b.signIn(email);
  renderApp(path);
  return { ...b, user: userEvent.setup() };
}
const heading = (name: string | RegExp, level = 1) => screen.findByRole("heading", { level, name }, WAIT);
const row = (code: string) => screen.getByRole("link", { name: code }).closest("li")!;
async function courseId(b: { agent: { get: (u: string) => Promise<{ body: { items: Array<{ id: number }> } }> } }, code: string) {
  return (await b.agent.get(`/api/courses?q=${code}`)).body.items[0]!.id;
}

describe("signed out", () => {
  it("shows the sign-in form and one-click demo accounts, and a demo click signs in", async () => {
    connectBrowser();
    renderApp("/");
    await heading("Sign in");
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Ana Reyes/ }, WAIT));
    expect(await screen.findByText(/Good (morning|afternoon|evening), Ana/, {}, WAIT)).toBeInTheDocument();
  });

  it("validates the form and reports a wrong password without revealing which part was wrong", async () => {
    connectBrowser();
    renderApp("/");
    const user = userEvent.setup();
    await heading("Sign in");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
    await user.type(screen.getByLabelText("Email"), "ana.reyes@student.test");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Incorrect email or password.", {}, WAIT)).toBeInTheDocument();
  });
});

describe("student: every page renders real data", () => {
  const pages: Array<[string, string | RegExp]> = [
    ["/catalog", "Course catalog"], ["/cart", "Course selection"], ["/enrollments", "My enrollments"], ["/schedule", "Weekly schedule"],
    ["/next", "What can I take next?"], ["/transcript", "Grades and transcript"], ["/progress", "Degree progress"],
    ["/overload", "Overload requests"], ["/registration", "Certificate of registration"],
  ];
  it.each(pages)("%s", async (path, title) => {
    await open("ana.reyes@student.test", path);
    await heading(title);
    // No page may be showing its error state.
    expect(screen.queryByText("Could not load this page")).not.toBeInTheDocument();
  });

  it("dashboard leads with the next class and shows units, GPA, and notifications", async () => {
    await open("jaya.katigbak@student.test", "/");
    expect(await screen.findByText(/Good (morning|afternoon|evening), Jaya/, {}, WAIT)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Next class" })).toBeInTheDocument();
    expect(await screen.findByText("Cumulative GPA")).toBeInTheDocument();
    expect(screen.getByText("3.22")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Units used" })).toBeInTheDocument();
  });

  it("course detail explains every reason a course is blocked", async () => {
    const b = connectBrowser();
    await b.signIn("ana.reyes@student.test");
    const id = await courseId(b, "CS201");
    renderApp(`/catalog/${id}`);
    await heading(/CS201 Algorithms/);
    expect(await screen.findByText("Why you cannot enroll yet", {}, WAIT)).toBeInTheDocument();
    expect(screen.getAllByText("Cannot enroll in CS201: requires CS102 (not completed)").length).toBeGreaterThan(0);
    expect(screen.getByText("Data Structures", { exact: false })).toBeInTheDocument();
  });

  it("transcript and degree progress show GPA, standing, and requirement status", async () => {
    await open("chloe.delacruz@student.test", "/transcript");
    expect(await screen.findByText("Dean's List", {}, WAIT)).toBeInTheDocument();
    cleanup();
    renderApp("/progress");
    expect(await screen.findByRole("img", { name: /percent of required units earned/ }, WAIT)).toBeInTheDocument();
    expect((await screen.findAllByText("Still needed", {}, WAIT)).length).toBeGreaterThan(0);
  });
});

describe("student: catalog behaviour", () => {
  it("shows seats honestly: a full class reads full with its waitlist, and the blocked button explains itself", async () => {
    await open("ana.reyes@student.test", "/catalog");
    await screen.findByText("CS240", {}, WAIT);
    expect(screen.getByRole("img", { name: "3 of 3 seats taken, 2 on the waitlist" })).toBeInTheDocument();
    expect(within(row("CS240")).getByText("Full")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Join waitlist CS240" }, WAIT)).toBeEnabled();
    const blocked = await screen.findByRole("button", { name: "Enroll CS201" }, WAIT);
    expect(blocked).toBeDisabled();
    expect(within(row("CS201")).getByText(/requires CS102 \(not completed\)/)).toBeInTheDocument();
  });

  it("filters by typing in the search box", async () => {
    const { user } = await open("ana.reyes@student.test", "/catalog");
    await screen.findByText("CS240", {}, WAIT);
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "data");
    expect(await screen.findByText("Data Structures", {}, WAIT)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Algorithms")).not.toBeInTheDocument(), WAIT);
  });

  it("enrolls, and joins a waitlist with its position", async () => {
    const { user } = await open("ana.reyes@student.test", "/catalog");
    await user.click(await screen.findByRole("button", { name: "Enroll CS102" }, WAIT));
    await waitFor(() => expect(within(row("CS102")).getByText("Enrolled")).toBeInTheDocument(), WAIT);
    await user.click(await screen.findByRole("button", { name: "Join waitlist CS240" }, WAIT));
    await waitFor(() => expect(within(row("CS240")).getByText("Waitlisted #3")).toBeInTheDocument(), WAIT);
  });

  it("a hold disables enrolling and the dashboard says why", async () => {
    await open("hana.ignacio@student.test", "/");
    expect(await screen.findByText("A financial hold is blocking your enrollment", {}, WAIT)).toBeInTheDocument();
    expect(screen.getAllByText(/Unpaid tuition balance/).length).toBeGreaterThan(0);
    cleanup();
    renderApp("/catalog");
    // Re-query inside the wait: when the dry-run verdict arrives the button is re-rendered inside its tooltip wrapper.
    await waitFor(() => expect(screen.getByRole("button", { name: "Enroll CS101" })).toBeDisabled(), WAIT);
  });
});

describe("student: cart", () => {
  it("add to cart, see it checked, submit, and read the per-item result", async () => {
    const { user } = await open("ana.reyes@student.test", "/catalog");
    await user.click(await screen.findByRole("button", { name: "Add CS102 to course selection" }, WAIT));
    await user.click(await screen.findByRole("button", { name: "Add CS201 to course selection" }, WAIT));
    await user.click(screen.getByRole("link", { name: /Course selection/ }));
    await heading("Course selection");
    expect(await screen.findByText("Ready to enroll", {}, WAIT)).toBeInTheDocument();
    expect(await screen.findByText(/requires CS102/, {}, WAIT)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Enroll in all \(2\)/ }));
    expect(await screen.findByText("Result of your last submit", {}, WAIT)).toBeInTheDocument();
    expect(await screen.findByText(/CS102: enrolled/, {}, WAIT)).toBeInTheDocument();
    expect(await screen.findByText(/CS201: not added/, {}, WAIT)).toBeInTheDocument();
    expect(screen.getAllByText("Cannot enroll in CS201: requires CS102 (in progress)")).toHaveLength(2); // the report, and the item left in the selection
  });
});

describe("student: schedule suggester", () => {
  it("finds the overlap in a cart and keeps the combination you choose", async () => {
    const b = connectBrowser();
    await b.signIn("ana.reyes@student.test");
    const me = (await b.agent.get("/api/auth/me")).body.user;
    const ids = await Promise.all(["MATH101", "BUS210", "CS102"].map((c) => courseId(b, c)));
    localStorage.setItem(`cart:${me.id}`, JSON.stringify(ids));
    renderApp("/cart");
    const user = userEvent.setup();
    await heading("Course selection");
    await user.click(await screen.findByRole("button", { name: "Check selected courses for overlaps" }, WAIT));
    expect(await screen.findByText(/MATH101 \(Tue\/Thu 11:00-12:30\) overlaps BUS210/, {}, WAIT)).toBeInTheDocument();
    expect(screen.getByText(/Leave out at least 1 course/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep BUS210 and CS102" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "MATH101" })).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: "BUS210" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CS102" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(`cart:${me.id}`)!)).toEqual(ids.filter((id) => id !== ids[0]));
  });
});

describe("student: dropping", () => {
  it("a normal drop says it will not reach the transcript, and removes the course", async () => {
    const { user } = await open("ana.reyes@student.test", "/enrollments");
    await user.click(await screen.findByRole("button", { name: "Drop MATH120" }, WAIT));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Drop MATH120?")).toBeInTheDocument();
    expect(within(dialog).getByText(/will not appear on your transcript/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Drop course" }));
    await waitFor(() => expect(screen.queryByText("MATH120")).not.toBeInTheDocument(), WAIT);
  });

  it("after the deadline the dialog warns that it becomes a W, and the course moves to the finished list", async () => {
    const { user } = await open("karl.lim@student.test", "/enrollments");
    expect(await screen.findByText("Past drop deadline", {}, WAIT)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Drop GE102" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Withdraw from GE102?")).toBeInTheDocument();
    expect(within(dialog).getByText(/appears on your transcript as W/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Withdraw (W on transcript)" }));
    expect(await screen.findByRole("heading", { name: "Finished or withdrawn (1)" }, WAIT)).toBeInTheDocument();
  });

  it("leaving a waitlist warns about losing your place", async () => {
    const { user } = await open("faye.gomez@student.test", "/enrollments");
    expect(await screen.findByText("Waitlisted #1", {}, WAIT)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Leave waitlist for CS240" }));
    expect(await screen.findByText(/lose your place in line \(you are #1\)/, {}, WAIT)).toBeInTheDocument();
  });

  it("when someone ahead drops, the next student is enrolled and sees it (second window)", async () => {
    const ben = connectBrowser();
    await ben.signIn("ben.cruz@student.test");
    const mine = (await ben.agent.get("/api/me/enrollments")).body.enrollments.find((e: { course: { code: string } }) => e.course.code === "CS240");
    await ben.agent.delete(`/api/enrollments/${mine.id}`).expect(200);

    const faye = connectBrowser();
    await faye.signIn("faye.gomez@student.test");
    renderApp("/enrollments");
    expect(await screen.findByRole("heading", { name: "Enrolled (4)" }, WAIT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notifications, 2 unread" })).toBeInTheDocument();
  });
});

describe("student: schedule, forms, shell", () => {
  it("signing out returns to the sign-in page and forgets the previous user", async () => {
    const { user } = await open("ana.reyes@student.test", "/");
    await screen.findByText(/Good (morning|afternoon|evening), Ana/, {}, WAIT);
    await user.click(screen.getByRole("button", { name: "Account menu for Ana Reyes" }));
    await user.click(await screen.findByRole("menuitem", { name: /Sign out/ }));
    await heading("Sign in");
    expect(screen.queryByText(/Ana/)).not.toBeInTheDocument();
  });

  it("schedule shows the timetable and a calendar export link", async () => {
    await open("ana.reyes@student.test", "/schedule");
    await heading("Weekly schedule");
    expect((await screen.findAllByText("MATH120", {}, WAIT)).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Export to calendar/ })).toHaveAttribute("href", expect.stringContaining("/api/me/schedule.ics"));
  });

  it("overload form validates, then submits and lists the request", async () => {
    const { user } = await open("lia.mendoza@student.test", "/overload");
    await heading("Overload requests");
    await user.type(screen.getByLabelText("Why do you need them?"), "short");
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText("Explain your request in at least 10 characters", {}, WAIT)).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Why do you need them?"));
    await user.type(screen.getByLabelText("Why do you need them?"), "I want to graduate a semester early.");
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText("+3 units for Fall 2026", {}, WAIT)).toBeInTheDocument();
    expect(screen.getByText("Waiting for a decision")).toBeInTheDocument();
  });

  it("command palette opens with Ctrl+K and navigates", async () => {
    const { user } = await open("ana.reyes@student.test", "/");
    await screen.findByText(/Good (morning|afternoon|evening), Ana/, {}, WAIT);
    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("combobox"), "sched");
    await user.click(await within(dialog).findByText("Weekly schedule"));
    await heading("Weekly schedule");
  });

  it("opening a notification marks it read (the bell count drops)", async () => {
    const { user } = await open("faye.gomez@student.test", "/");
    await user.click(await screen.findByRole("button", { name: /Notifications, 1 unread/ }, WAIT));
    const item = await screen.findByRole("menuitem", { name: /on the waitlist for CS240/ }, WAIT);
    expect(within(item).getByText("(unread)", { exact: false })).toBeInTheDocument();
    await user.click(item);
    // The open menu hides the bell from assistive tech, so assert on the item itself.
    await waitFor(() => expect(within(screen.getByRole("menuitem", { name: /on the waitlist for CS240/ })).queryByText("(unread)", { exact: false })).not.toBeInTheDocument(), WAIT);
  });

  it("theme toggle switches to dark and back", async () => {
    const { user } = await open("ana.reyes@student.test", "/");
    await screen.findByText(/Good (morning|afternoon|evening), Ana/, {}, WAIT);
    await user.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    await user.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("a student who guesses an admin URL is told they have no access, and unknown pages say so", async () => {
    await open("ana.reyes@student.test", "/admin/audit");
    expect(await screen.findByText("You do not have access to this page", {}, WAIT)).toBeInTheDocument();
    cleanup();
    renderApp("/no-such-page");
    expect(await screen.findByText("We could not find that page", {}, WAIT)).toBeInTheDocument();
  });
});

describe("instructor", () => {
  it("lists classes, opens a roster with waitlist order, and validates then saves a grade", async () => {
    const { user } = await open("instructor@school.test", "/instructor");
    await heading("My classes");
    await user.click((await screen.findAllByRole("link", { name: "Class roster and grades" }, WAIT))[4]!);
    await heading(/CS240 Mobile Application Development/);
    expect((await screen.findAllByText("Waitlisted #1", {}, WAIT)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Waitlisted #2").length).toBeGreaterThan(0);

    const input = screen.getAllByLabelText("Grade for Ben Cruz")[0]!;
    await user.type(input, "9");
    await user.click(screen.getAllByRole("button", { name: "Save grade for Ben Cruz" })[0]!);
    expect(await screen.findByText("Use 0 to 4.", {}, WAIT)).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "3.5");
    await user.click(screen.getAllByRole("button", { name: "Save grade for Ben Cruz" })[0]!);
    await waitFor(() => expect(screen.getAllByText("A-").length).toBeGreaterThan(0), WAIT);
  });
});

describe("admin", () => {
  const pages: Array<[string, string]> = [
    ["/admin", "Overview"], ["/admin/courses", "Courses"], ["/admin/students", "Students"], ["/admin/instructors", "Instructors"],
    ["/admin/terms", "Academic terms"], ["/admin/holds", "Holds"], ["/admin/overloads", "Overload requests"], ["/admin/announcements", "Announcements"],
    ["/admin/audit", "Audit log"], ["/admin/rush", "Rush Simulator"], ["/admin/exports", "Exports"],
  ];
  it.each(pages)("%s", async (path, title) => {
    await open("admin@school.test", path);
    await heading(title);
    expect(screen.queryByText("Could not load this page")).not.toBeInTheDocument();
  });

  it("overview reports totals, the fullest course, and the waitlist", async () => {
    await open("admin@school.test", "/admin");
    expect(await screen.findByText("Seats taken", {}, WAIT)).toBeInTheDocument();
    expect((await screen.findAllByText("CS240", {}, WAIT)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2 waiting/).length).toBeGreaterThan(0);
  });

  it("clearing a hold asks first, then removes it", async () => {
    const { user } = await open("admin@school.test", "/admin/holds");
    await user.click((await screen.findAllByRole("button", { name: "Clear hold for Hana Ignacio" }, WAIT))[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/will be able to enroll again/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Clear hold" }));
    expect(await screen.findByText("No holds", {}, WAIT)).toBeInTheDocument();
  });

  it("the course form checks its input with the same schema as the API", async () => {
    const { user } = await open("admin@school.test", "/admin/courses");
    await user.click(await screen.findByRole("button", { name: /New course/ }, WAIT));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Create course" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/code/);
  });

  it("the Rush Simulator proves no over-enrollment, and reset restores the scenario", async () => {
    const { user } = await open("admin@school.test", "/admin/rush");
    await heading("Rush Simulator");
    await waitFor(() => expect(screen.getByRole("button", { name: /Run simulation/ })).toBeEnabled(), WAIT);
    await user.click(screen.getByRole("button", { name: /Run simulation/ }));
    expect(await screen.findByText("No over-enrollment: 6 of 6 seats taken", {}, { timeout: 45_000 })).toBeInTheDocument();
    expect(screen.getByText(/40 students asked for ENGL210 at once\. 1 got a seat, 39 joined the waitlist/)).toBeInTheDocument();
    await act(async () => { await user.click(screen.getByRole("button", { name: /Reset scenario/ })); });
    await waitFor(() => expect(screen.queryByText(/No over-enrollment/)).not.toBeInTheDocument(), WAIT);
  }, 90_000);
});
