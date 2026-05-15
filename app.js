import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

// ─── Helpers ────────────────────────────────────────────────────────────────

const qs = (s, ctx = document) => ctx.querySelector(s);
const qsa = (s, ctx = document) => [...ctx.querySelectorAll(s)];

function escapeHtml(s) {
    return String(s).replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[c],
    );
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("File read failed"));
        reader.readAsDataURL(file);
    });
}

function wireImagePicker(inputEl, previewEl) {
    let currentFile = null;

    inputEl.addEventListener("change", () => {
        const file = inputEl.files[0];
        if (!file) return;

        currentFile = file;

        const url = URL.createObjectURL(file);
        previewEl.src = url;
        previewEl.style.display = "block";
    });

    return {
        get value() {
            return currentFile;
        },
        reset() {
            currentFile = null;
            inputEl.value = "";
            previewEl.src = "";
            previewEl.style.display = "none";
        },
    };
}

// ─── API base ────────────────────────────────────────────────────────────────

function normalizeAPI(input) {
    if (!input) return "http://localhost:3000";
    let url = input.trim();
    if (!url.startsWith("http")) url = "http://" + url;
    const u = new URL(url);
    if (!u.port) u.port = "3000";
    return `${u.protocol}//${u.hostname}:${u.port}`;
}

function promptForAPI() {
    let saved = localStorage.getItem("apiBase");

    if (saved) return saved;

    let input = prompt(
        "Enter server address (example: http://192.168.1.10:3000 or https://api.yoursite.com)",
    );

    if (!input) {
        alert("No API provided. Using localhost fallback.");
        input = "http://localhost:3000";
    }

    const normalized = normalizeAPI(input);
    localStorage.setItem("apiBase", normalized);
    return normalized;
}

const API = "https://fragrance-criticism-tablet-louisville.trycloudflare.com"

// ─── State ───────────────────────────────────────────────────────────────────

let account = null;
let posts = [];

// Tracks the current user's vote per post for this session
const sessionVotes = new Map();

// ─── Element cache ───────────────────────────────────────────────────────────

const el = {
    feed: qs("#feed"),

    signUpBtn: qs("#btn-create-account"),
    newPostBtn: qs("#btn-new-post"),
    profileBtn: qs("#btn-profile"),
    topbarPfp: qs("#topbar-pfp"),

    dropdown: qs("#profile-dropdown"),
    dropdownPfp: qs("#dropdown-pfp"),
    dropdownUsername: qs("#dropdown-username"),

    backdrop: qs("#modal-backdrop"),
    signupModal: qs("#modal-account"),
    editModal: qs("#modal-edit"),
    postModal: qs("#modal-post"),
};

// ─── Image pickers ───────────────────────────────────────────────────────────

const signupPfpPicker = wireImagePicker(
    qs("#acct-pfp"),
    qs("#acct-pfp-preview"),
);
const editPfpPicker = wireImagePicker(qs("#edit-pfp"), qs("#edit-pfp-preview"));
const postImagePicker = wireImagePicker(
    qs("#post-image"),
    qs("#post-image-preview"),
);

// ─── Modal system ────────────────────────────────────────────────────────────

function openModal(m) {
    el.backdrop.classList.remove("hidden");
    m.classList.remove("hidden");
    m.querySelector("input, textarea")?.focus();
}

function closeModals() {
    el.backdrop.classList.add("hidden");
    [el.signupModal, el.editModal, el.postModal].forEach((m) =>
        m.classList.add("hidden"),
    );
    closeDropdown();
}

el.backdrop.addEventListener("click", closeModals);
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModals();
});

// ─── Dropdown ────────────────────────────────────────────────────────────────

function openDropdown() {
    el.dropdown.classList.remove("hidden");
    el.profileBtn.setAttribute("aria-expanded", "true");
}

function closeDropdown() {
    el.dropdown.classList.add("hidden");
    el.profileBtn.setAttribute("aria-expanded", "false");
}

function toggleDropdown() {
    el.dropdown.classList.contains("hidden") ? openDropdown() : closeDropdown();
}

document.addEventListener("click", (e) => {
    if (
        !el.dropdown.classList.contains("hidden") &&
        !el.dropdown.contains(e.target) &&
        e.target !== el.profileBtn
    ) {
        closeDropdown();
    }
});

// ─── Default avatar ──────────────────────────────────────────────────────────

function defaultPfpFor(seed) {
    const h = [...String(seed)].reduce((a, c) => a + c.charCodeAt(0), 0);
    const color = `hsl(${h % 360},55%,58%)`;
    const initials = String(seed).slice(0, 2).toUpperCase();
    return (
        "data:image/svg+xml," +
        encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">` +
                `<rect width="100%" height="100%" fill="${color}"/>` +
                `<text x="50%" y="50%" fill="white" font-family="sans-serif" ` +
                `font-size="38" font-weight="600" text-anchor="middle" dy=".35em">${initials}</text>` +
                `</svg>`,
        )
    );
}

// ─── Topbar ───────────────────────────────────────────────────────────────────

function renderTopbar() {
    if (!account) {
        el.signUpBtn.style.display = "inline-flex";
        el.newPostBtn.style.display = "none";
        el.profileBtn.style.display = "none";
        return;
    }

    el.signUpBtn.style.display = "none";
    el.newPostBtn.style.display = "inline-flex";
    el.profileBtn.style.display = "inline-flex";

    const pfp = account.pfp || defaultPfpFor(account.username || "u");
    el.topbarPfp.src = pfp;
    el.dropdownPfp.src = pfp;
    el.dropdownUsername.textContent = account.username;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function autoLogin() {
    const token = localStorage.getItem("deviceToken");
    if (!token) return;

    try {
        const r = await fetch(`${API}/users/me`, {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (!r.ok) {
            localStorage.removeItem("deviceToken");
            return;
        }

        account = await r.json();
        account.token = token;
    } catch {
        // server unreachable — stay logged out silently
    }
}

// ─── Feed ─────────────────────────────────────────────────────────────────────

async function loadFeed() {
    try {
        const r = await fetch(`${API}/posts`);
        if (!r.ok) throw new Error();
        posts = await r.json();
    } catch {
        el.feed.innerHTML = `<p style="color:var(--muted);text-align:center;padding:2rem">Could not reach the server.</p>`;
        return;
    }
    renderFeed();
}

function renderFeed() {
    el.feed.innerHTML = "";

    if (posts.length === 0) {
        el.feed.innerHTML = `<p style="color:var(--muted);text-align:center;padding:2rem">No posts yet. Be the first!</p>`;
        return;
    }

    posts.forEach((post) => el.feed.appendChild(buildCard(post)));
}

// ─── Card builder ─────────────────────────────────────────────────────────────

function buildCard(post) {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.postId = post.id;

    const author = post.authorName || "unknown";
    const pfpSrc = post.authorPfp || defaultPfpFor(author);
    const userVote = sessionVotes.get(post.id) ?? 0;
    const comments = post.comments ?? [];

    // ── left column ──────────────────────────────────────────────────────────
    const left = document.createElement("div");
    left.className = "post-left";

    const avatarImg = document.createElement("img");
    avatarImg.className = "pfp";
    avatarImg.alt = `${author}'s avatar`;
    avatarImg.src = `${API}/uploads/${pfpSrc}`;

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = `vote-btn${userVote === 1 ? " voted" : ""}`;
    upBtn.title = "Upvote";
    upBtn.textContent = "▲";

    const likesEl = document.createElement("div");
    likesEl.className = "muted vote-count";
    likesEl.textContent = post.likes ?? 0;

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = `vote-btn${userVote === -1 ? " voted" : ""}`;
    downBtn.title = "Downvote";
    downBtn.textContent = "▼";

    const dislikesEl = document.createElement("div");
    dislikesEl.className = "muted vote-count";
    dislikesEl.textContent = post.dislikes ?? 0;

    upBtn.addEventListener("click", () =>
        vote(post.id, 1, upBtn, downBtn, likesEl, dislikesEl),
    );
    downBtn.addEventListener("click", () =>
        vote(post.id, -1, upBtn, downBtn, likesEl, dislikesEl),
    );

    left.append(avatarImg, upBtn, likesEl, downBtn, dislikesEl);

    // ── main column ───────────────────────────────────────────────────────────
    const main = document.createElement("div");
    main.className = "post-main";

    const meta = document.createElement("div");
    meta.className = "post-meta";
    meta.innerHTML =
        `<span>u/${escapeHtml(author)}</span>` +
        `<span>·</span>` +
        `<span class="time" data-ts="${post.createdAt}">${dayjs(post.createdAt).fromNow()}</span>`;

    const title = document.createElement("div");
    title.className = "post-title";
    title.textContent = post.title;

    main.append(meta, title);

    if (post.description) {
        const desc = document.createElement("div");
        desc.className = "post-desc";
        desc.textContent = post.description;
        main.appendChild(desc);
    }

    if (post.image) {
        const img = document.createElement("img");
        img.className = "post-image";
        img.alt = "Post image";
        img.loading = "lazy";
        img.src = `${API}/uploads/${post.image}`;
        main.appendChild(img);
    }

    // ── comments ──────────────────────────────────────────────────────────────
    const footer = document.createElement("div");
    footer.className = "post-footer";

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "toggle-comments-btn";
    toggleBtn.textContent = `💬 ${comments.length} comment${comments.length !== 1 ? "s" : ""}`;
    footer.appendChild(toggleBtn);
    main.appendChild(footer);

    const commentsSection = document.createElement("div");
    commentsSection.className = "comments hidden";
    commentsSection.id = `comments-${post.id}`;

    if (comments.length === 0) {
        const empty = document.createElement("p");
        empty.className = "no-comments";
        empty.textContent = "No comments yet.";
        commentsSection.appendChild(empty);
    } else {
        comments.forEach((c) =>
            commentsSection.appendChild(buildCommentNode(c)),
        );
    }

    if (account) {
        commentsSection.appendChild(
            buildComposeRow(post.id, toggleBtn, commentsSection),
        );
    } else {
        const hint = document.createElement("p");
        hint.className = "muted";
        hint.style.cssText = "font-size:12px;padding:4px 0";
        hint.textContent = "Sign in to comment.";
        commentsSection.appendChild(hint);
    }

    main.appendChild(commentsSection);

    toggleBtn.addEventListener("click", () =>
        commentsSection.classList.toggle("hidden"),
    );

    card.append(left, main);
    return card;
}

function buildComposeRow(postId, toggleBtn, commentsSection) {
    const compose = document.createElement("div");
    compose.className = "comment-compose";

    const composePfp = document.createElement("img");
    composePfp.alt = "";
    composePfp.width = 26;
    composePfp.height = 26;
    composePfp.style.cssText =
        "width:26px;height:26px;min-width:26px;border-radius:6px;object-fit:cover;flex-shrink:0;";
    composePfp.src = account.pfp || defaultPfpFor(account.username);

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Add a comment…";
    input.maxLength = 500;

    const sendBtn = document.createElement("button");
    sendBtn.type = "button";
    sendBtn.textContent = "Send";

    compose.append(composePfp, input, sendBtn);

    const submit = () => {
        const text = input.value.trim();
        if (!text) return;
        input.value = "";
        postComment(postId, text, commentsSection, toggleBtn);
    };

    sendBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
    });

    return compose;
}

function buildCommentNode(c) {
    const name = c.authorName || "unknown";
    const pfpSrc = c.authorPfp || defaultPfpFor(name);

    const wrap = document.createElement("div");
    wrap.className = "comment";

    const pfpImg = document.createElement("img");
    pfpImg.className = "c-pfp";
    pfpImg.alt = `${name}'s avatar`;
    pfpImg.src = `${API}/uploads/${pfpSrc}`;

    const body = document.createElement("div");
    body.className = "c-body";

    const metaDiv = document.createElement("div");
    metaDiv.className = "c-meta";
    metaDiv.innerHTML =
        `<strong>${escapeHtml(name)}</strong>` +
        ` · <span class="time" data-ts="${c.createdAt}">${dayjs(c.createdAt).fromNow()}</span>`;

    const textDiv = document.createElement("div");
    textDiv.textContent = c.text;

    body.append(metaDiv, textDiv);
    wrap.append(pfpImg, body);
    return wrap;
}

// ─── Voting — optimistic, fire-and-forget ────────────────────────────────────

function vote(postId, value, upBtn, downBtn, likesEl, dislikesEl) {
    if (!account) return alert("Sign in to vote.");

    const prev = sessionVotes.get(postId) ?? 0;

    let likes = parseInt(likesEl.textContent, 10);
    let dislikes = parseInt(dislikesEl.textContent, 10);

    if (prev === 1) likes--;
    if (prev === -1) dislikes--;

    const next = prev === value ? 0 : value;

    if (next === 1) likes++;
    if (next === -1) dislikes++;

    // Update DOM immediately — no waiting on network
    sessionVotes.set(postId, next);
    likesEl.textContent = likes;
    dislikesEl.textContent = dislikes;
    upBtn.classList.toggle("voted", next === 1);
    downBtn.classList.toggle("voted", next === -1);

    if (next === 0) return;

    // Fire and forget — no await, no spinner
    fetch(`${API}/posts/${postId}/vote`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${account.token}`,
        },
        body: JSON.stringify({ value: next }),
    })
        .then((r) => {
            if (!r.ok) throw new Error();
        })
        .catch(() => {
            // Roll back silently
            sessionVotes.set(postId, prev);
            if (next === 1) likes--;
            if (next === -1) dislikes--;
            if (prev === 1) likes++;
            if (prev === -1) dislikes++;
            likesEl.textContent = likes;
            dislikesEl.textContent = dislikes;
            upBtn.classList.toggle("voted", prev === 1);
            downBtn.classList.toggle("voted", prev === -1);
        });
}

// ─── Comments — optimistic, fire-and-forget ──────────────────────────────────

function postComment(postId, text, commentsSection, toggleBtn) {
    // Build and insert the comment node immediately from local state
    const optimistic = {
        authorName: account.username,
        authorPfp: account.pfp || null,
        text,
        createdAt: Date.now(),
    };

    const noMsg = commentsSection.querySelector(".no-comments");
    const compose = commentsSection.querySelector(".comment-compose");

    if (noMsg) noMsg.remove();
    commentsSection.insertBefore(buildCommentNode(optimistic), compose);

    const prev = parseInt(toggleBtn.textContent.match(/\d+/)?.[0] ?? "0", 10);
    const next = prev + 1;
    toggleBtn.textContent = `💬 ${next} comment${next !== 1 ? "s" : ""}`;

    // Fire and forget — no await, no spinner
    fetch(`${API}/posts/${postId}/comments`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${account.token}`,
        },
        body: JSON.stringify({ text }),
    }).catch(() => {
        // Nothing to do — comment is already shown
    });
}

// ─── Register ─────────────────────────────────────────────────────────────────

async function register(username, pfp) {
    if (!username.trim()) return alert("Username is required.");

    try {
        let pfpUrl = null;

        if (pfp) {
            pfpUrl = await uploadImage(pfp); // <-- uses your /upload route
        }

        const r = await fetch(`${API}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: username.trim(),
                pfp: pfpUrl,
            }),
        });

        const data = await r.json();
        if (!r.ok) return alert(data.message || "Registration failed.");

        localStorage.setItem("deviceToken", data.token);
        account = { ...data };

        closeModals();
        signupPfpPicker.reset();
        qs("#acct-username").value = "";

        renderTopbar();
        await loadFeed();
    } catch {
        alert("Could not reach the server.");
    }
}

// ─── Edit profile — update in place, no reload ───────────────────────────────

async function updateProfile(username, pfp) {
    const body = {};

    if (username && username.trim() !== account.username)
        body.username = username.trim();
    if (pfp) body.pfp = pfp;

    if (!Object.keys(body).length) {
        closeModals();
        return;
    }

    try {
        const r = await fetch(`${API}/users/me`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${account.token}`,
            },
            body: JSON.stringify(body),
        });

        const data = await r.json();
        if (!r.ok) return alert(data.message || "Update failed.");

        account = { ...account, ...data };
        closeModals();
        editPfpPicker.reset();
        renderTopbar();

        // Update this user's avatar/name on every card and compose row in the feed
        if (body.pfp || body.username) {
            const newPfp = account.pfp || defaultPfpFor(account.username);
            const newName = account.username;

            // Author avatars on their own posts
            qsa(".card").forEach((card) => {
                const postId = card.dataset.postId;
                const post = posts.find((p) => p.id === postId);
                if (
                    post?.authorId === account.id ||
                    post?.authorName === account.username
                ) {
                    const avatar = card.querySelector(".post-left .pfp");
                    if (avatar) avatar.src = newPfp;
                }
            });

            // Compose row pfp on every card
            qsa(".comment-compose img").forEach((img) => {
                img.src = newPfp;
            });

            // Comment nodes authored by this user
            qsa(".comment").forEach((commentEl) => {
                const strong = commentEl.querySelector(".c-meta strong");
                if (
                    strong?.textContent === account.username ||
                    strong?.textContent === newName
                ) {
                    const cPfp = commentEl.querySelector(".c-pfp");
                    if (cPfp) cPfp.src = newPfp;
                }
            });
        }
    } catch {
        alert("Could not reach the server.");
    }
}

// ─── Create post — prepend card, no reload ────────────────────────────────────

async function createPost(title, description, image) {
    if (!title.trim()) return alert("Title is required.");

    try {
        let imageUrl = null;

        if (image instanceof File) {
            imageUrl = await uploadImage(image);
        }

        const r = await fetch(`${API}/posts`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${account.token}`,
            },
            body: JSON.stringify({
                title: title.trim(),
                description: description.trim() || null,
                image: imageUrl,
            }),
        });

        const data = await r.json();
        if (!r.ok) return alert(data.message || "Post failed.");

        closeModals();
        postImagePicker.reset();

        const newPost = {
            ...data,
            authorName: account.username,
            authorPfp: account.pfp || null,
            likes: 0,
            dislikes: 0,
            comments: [],
        };

        posts.unshift(newPost);
        el.feed.insertBefore(buildCard(newPost), el.feed.firstChild);
    } catch {
        alert("Could not reach the server.");
    }
}

// ─── Refresh timestamps ───────────────────────────────────────────────────────

function refreshTimestamps() {
    qsa(".time[data-ts]").forEach((node) => {
        node.textContent = dayjs(Number(node.dataset.ts)).fromNow();
    });
}

setInterval(refreshTimestamps, 60_000);

// ─── Event wiring ─────────────────────────────────────────────────────────────

el.signUpBtn.addEventListener("click", () => openModal(el.signupModal));
el.newPostBtn.addEventListener("click", () => openModal(el.postModal));

el.profileBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDropdown();
});

qs("#acct-save").addEventListener("click", () => {
    register(qs("#acct-username").value, signupPfpPicker.value);
});

qs("#dropdown-edit").addEventListener("click", () => {
    closeDropdown();
    qs("#edit-username").value = account?.username ?? "";
    const preview = qs("#edit-pfp-preview");
    if (account?.pfp) {
        preview.src = account.pfp;
        preview.style.display = "block";
    } else {
        preview.style.display = "none";
    }
    openModal(el.editModal);
});

qs("#edit-save").addEventListener("click", () => {
    updateProfile(qs("#edit-username").value, editPfpPicker.value);
});

qs("#post-submit").addEventListener("click", () => {
    createPost(
        qs("#post-title").value,
        qs("#post-desc").value,
        postImagePicker.value,
    );
});

qsa(".secondary").forEach((btn) => {
    if (btn.id.includes("cancel")) btn.addEventListener("click", closeModals);
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function init() {
    const styleTag = document.createElement("style");
    styleTag.textContent = `.comment-compose img { width:26px !important; height:26px !important; min-width:26px !important; border-radius:6px !important; object-fit:cover !important; flex-shrink:0 !important; }`;
    document.head.appendChild(styleTag);
    document.querySelectorAll("button:not([type])").forEach((b) => {
        b.type = "button";
    });

    await autoLogin();
    renderTopbar();
    await loadFeed();
}

async function uploadImage(file) {
    const form = new FormData();
    form.append("image", file);

    const r = await fetch(`${API}/upload`, {
        method: "POST",
        body: form,
    });

    const data = await r.json();
    return data.url; // /uploads/abc.webp
}

init();
