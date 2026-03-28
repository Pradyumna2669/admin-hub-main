import os
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import aiohttp
import discord
from discord import app_commands
from discord.ext import commands


ALLOWED_GUILD_ID = int(os.getenv("DISCORD_GUILD_ID", "1451962862388903949"))
DEFAULT_ADMIN_ROLE_IDS = {
    1455537987394736180,
    1453283262083629168,
    1453288336515928164,
    1453288195327397970,
}
ADMIN_ROLE_IDS = set(DEFAULT_ADMIN_ROLE_IDS)
_env_role_ids = os.getenv("DISCORD_ADMIN_ROLE_IDS", "")
if _env_role_ids.strip():
    for raw in _env_role_ids.split(","):
        raw = raw.strip()
        if raw:
            try:
                ADMIN_ROLE_IDS.add(int(raw))
            except ValueError:
                pass

DEFAULT_ADMIN_USER_IDS = set()
ADMIN_USER_IDS = set(DEFAULT_ADMIN_USER_IDS)
_env_admin_ids = os.getenv("DISCORD_ADMIN_USER_IDS", "")
if _env_admin_ids.strip():
    for raw in _env_admin_ids.split(","):
        raw = raw.strip()
        if raw:
            try:
                ADMIN_USER_IDS.add(int(raw))
            except ValueError:
                pass

SUPABASE_URL = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
PUBLIC_SITE_URL = (os.getenv("PUBLIC_SITE_URL") or "").rstrip("/")

DISCORD_EMAIL_DOMAIN = os.getenv("DISCORD_EMAIL_DOMAIN", "discord.local")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


DEFAULT_TASK_TYPE_RATES_INR_BY_LEAGUE = {
    "bronze": {
        "normal_comment": 15,
        "support_comment": 10,
        "linked_comments": 20,
        "non_linked_crosspost": 30,
        "linked_post_crosspost": 30,
        "non_linked_post": 40,
        "linked_post": 50,
    },
    "silver": {
        "normal_comment": 20,
        "support_comment": 15,
        "linked_comments": 25,
        "non_linked_crosspost": 30,
        "linked_post_crosspost": 30,
        "non_linked_post": 50,
        "linked_post": 70,
    },
    "gold": {
        "normal_comment": 20,
        "support_comment": 15,
        "linked_comments": 25,
        "non_linked_crosspost": 35,
        "linked_post_crosspost": 35,
        "non_linked_post": 60,
        "linked_post": 80,
    },
    "platinum": {
        "normal_comment": 25,
        "support_comment": 18,
        "linked_comments": 30,
        "non_linked_crosspost": 40,
        "linked_post_crosspost": 40,
        "non_linked_post": 100,
        "linked_post": 150,
    },
    "diamond": {
        "normal_comment": 30,
        "support_comment": 20,
        "linked_comments": 35,
        "non_linked_crosspost": 50,
        "linked_post_crosspost": 50,
        "non_linked_post": 150,
        "linked_post": 200,
    },
}

LEGACY_TASK_TYPE_MAP = {
    "comment": "normal_comment",
    "linked_comment": "linked_comments",
    "normal_post": "non_linked_post",
    "linked_post": "linked_post",
}

CQS_RANKS = {
    "low": 0,
    "moderate": 1,
    "high": 2,
    "highest": 3,
}


def normalize_task_type(task_type: Optional[str]) -> Optional[str]:
    if not task_type:
        return None
    trimmed = task_type.strip()
    if not trimmed:
        return None
    normalized = trimmed.lower()
    if normalized in DEFAULT_TASK_TYPE_RATES_INR_BY_LEAGUE["bronze"]:
        return normalized
    return LEGACY_TASK_TYPE_MAP.get(normalized)


def derive_karma_from_range(karma_range: Optional[str]) -> Optional[int]:
    if not karma_range:
        return None
    normalized = karma_range.strip().lower()
    if not normalized:
        return None
    if "200" in normalized and "1k" in normalized:
        return 200
    if normalized.startswith("1k"):
        return 1_000
    if normalized.startswith("5k"):
        return 5_000
    if normalized.startswith("25k"):
        return 25_000
    if normalized.startswith("50k"):
        return 50_000
    if normalized.startswith("100k"):
        return 100_000
    if normalized.startswith("<1k"):
        return 0
    return None


def compute_league(karma: Optional[int], karma_range: Optional[str], cqs: Optional[str]) -> str:
    value = karma if isinstance(karma, int) else derive_karma_from_range(karma_range) or 0
    if value >= 50_000:
        base = "diamond"
    elif value >= 25_000:
        base = "platinum"
    elif value >= 5_000:
        base = "gold"
    elif value >= 1_000:
        base = "silver"
    else:
        base = "bronze"

    if cqs and cqs.strip().lower() in {"high", "highest"}:
        return {
            "bronze": "silver",
            "silver": "gold",
            "gold": "platinum",
            "platinum": "diamond",
            "diamond": "diamond",
        }[base]
    return base


def normalize_cqs_level(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    normalized = value.strip().lower()
    if normalized in CQS_RANKS:
        return normalized
    return None


def meets_minimum_cqs(worker_cqs: Optional[str], task_cqs_levels: Optional[List[str]]) -> bool:
    valid_levels = [
        normalize_cqs_level(level)
        for level in (task_cqs_levels or [])
        if normalize_cqs_level(level) is not None
    ]
    if not valid_levels:
        return True
    worker_level = normalize_cqs_level(worker_cqs)
    if not worker_level:
        return False
    minimum_required = min(CQS_RANKS[level] for level in valid_levels)
    return CQS_RANKS[worker_level] >= minimum_required

class SupabaseClient:
    def __init__(self, url: str, key: str) -> None:
        self.base_url = url.rstrip("/")
        self.key = key
        self.session = aiohttp.ClientSession()

    async def close(self) -> None:
        await self.session.close()

    def _headers(self, prefer: Optional[str] = None) -> Dict[str, str]:
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        return headers

    async def rest_request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        payload: Optional[Any] = None,
        prefer: Optional[str] = None,
    ) -> Tuple[int, Any]:
        url = f"{self.base_url}/rest/v1/{path.lstrip('/')}"
        async with self.session.request(
            method, url, params=params, json=payload, headers=self._headers(prefer)
        ) as response:
            if response.status == 204:
                return response.status, None
            data = await response.json(content_type=None)
            return response.status, data

    async def admin_request(
        self,
        method: str,
        path: str,
        payload: Optional[Any] = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> Tuple[int, Any]:
        url = f"{self.base_url}/auth/v1/admin/{path.lstrip('/')}"
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }
        async with self.session.request(
            method, url, params=params, json=payload, headers=headers
        ) as response:
            data = await response.json(content_type=None)
            return response.status, data


def require_env(value: Optional[str], name: str) -> str:
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def format_money(value: Any) -> str:
    try:
        return f"{float(value):.2f}"
    except Exception:
        return "0.00"

class AdminHubCog(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot
        self.supabase = SupabaseClient(
            require_env(SUPABASE_URL, "SUPABASE_URL"),
            require_env(SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY"),
        )

    async def cog_unload(self) -> None:
        await self.supabase.close()

    def _guild_only(self, interaction: discord.Interaction) -> bool:
        return interaction.guild_id == ALLOWED_GUILD_ID

    async def _is_admin(self, interaction: discord.Interaction) -> bool:
        user_id = interaction.user.id
        if user_id in ADMIN_USER_IDS:
            return True
        guild = interaction.guild
        if guild is None:
            return False

        member = None
        if isinstance(interaction.user, discord.Member):
            member = interaction.user
        else:
            try:
                member = guild.get_member(user_id)
                if member is None:
                    member = await guild.fetch_member(user_id)
            except Exception:
                member = None

        if member is None:
            return False
        return any(role.id in ADMIN_ROLE_IDS for role in member.roles)

    async def _gemini_generate(self, prompt: str) -> str:
        if not GEMINI_API_KEY:
            raise RuntimeError("GEMINI_API_KEY is not configured.")

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
        payload = {
            "contents": [
                {
                    "parts": [
                        {
                            "text": (
                                "You are a helpful assistant for taskers. "
                                "Explain websites and tasks clearly, concisely, and step by step when needed.\n\n"
                                f"User: {prompt}"
                            )
                        }
                    ]
                }
            ]
        }
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": GEMINI_API_KEY,
        }

        async with self.supabase.session.post(url, json=payload, headers=headers) as response:
            data = await response.json(content_type=None)
            if response.status != 200:
                message = data.get("error", {}).get("message") if isinstance(data, dict) else None
                raise RuntimeError(message or f"Gemini API error (status {response.status}).")

        if not isinstance(data, dict):
            raise RuntimeError("Unexpected Gemini response format.")

        candidates = data.get("candidates") or []
        if not candidates:
            raise RuntimeError("Gemini returned no candidates.")

        content = candidates[0].get("content") or {}
        parts = content.get("parts") or []
        if not parts:
            raise RuntimeError("Gemini returned empty content.")

        text = parts[0].get("text")
        if not text:
            raise RuntimeError("Gemini returned no text.")
        return text

    def _chunk_message(self, text: str, limit: int = 1900) -> List[str]:
        if not text:
            return []
        chunks = []
        current = []
        current_len = 0
        for line in text.splitlines():
            line_len = len(line) + 1
            if current_len + line_len > limit and current:
                chunks.append("\n".join(current))
                current = [line]
                current_len = len(line)
            else:
                current.append(line)
                current_len += line_len
        if current:
            chunks.append("\n".join(current))
        return chunks

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message) -> None:
        if message.author.bot:
            return

        content = (message.content or "").strip()
        if not content.lower().startswith("beta"):
            await self.bot.process_commands(message)
            return

        if message.guild and message.guild.id != ALLOWED_GUILD_ID:
            await self.bot.process_commands(message)
            return

        prompt = content[4:].strip()
        if not prompt:
            await message.channel.send("Use `beta <your question>` to ask the AI helper.")
            await self.bot.process_commands(message)
            return

        async with message.channel.typing():
            try:
                reply = await self._gemini_generate(prompt)
            except Exception as exc:
                await message.channel.send(f"AI error: {exc}")
                await self.bot.process_commands(message)
                return

        for chunk in self._chunk_message(reply):
            await message.channel.send(chunk)

        await self.bot.process_commands(message)
    async def _get_profile_by_discord_id(self, discord_id: int) -> Optional[Dict[str, Any]]:
        status, data = await self.supabase.rest_request(
            "GET",
            "profiles",
            params={
                "select": "user_id,email,full_name,discord_user_id,discord_username",
                "discord_user_id": f"eq.{discord_id}",
            },
        )
        if status != 200 or not data:
            return None
        return data[0]

    async def _get_profile_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        status, data = await self.supabase.rest_request(
            "GET",
            "profiles",
            params={
                "select": "user_id,email,full_name,discord_user_id,discord_username",
                "email": f"eq.{email}",
            },
        )
        if status != 200 or not data:
            return None
        return data[0]

    async def _update_profile_discord_link(
        self, user_id: str, discord_id: int, discord_username: str
    ) -> Optional[Dict[str, Any]]:
        status, data = await self.supabase.rest_request(
            "PATCH",
            "profiles",
            params={"user_id": f"eq.{user_id}"},
            payload={
                "discord_user_id": str(discord_id),
                "discord_username": discord_username,
            },
            prefer="return=representation",
        )
        if status not in (200, 201) or not data:
            return None
        return data[0]

    async def _create_auth_user(self, email: str, discord_id: int, discord_username: str) -> Optional[str]:
        password = secrets.token_urlsafe(24)
        status, data = await self.supabase.admin_request(
            "POST",
            "users",
            payload={
                "email": email,
                "password": password,
                "email_confirm": True,
                "user_metadata": {
                    "discord_id": str(discord_id),
                    "discord_username": discord_username,
                },
            },
        )
        if status not in (200, 201) or not isinstance(data, dict):
            return None
        return data.get("id")

    async def _generate_magic_link(self, email: str) -> Optional[str]:
        if not PUBLIC_SITE_URL:
            return None
        status, data = await self.supabase.admin_request(
            "POST",
            "generate_link",
            payload={
                "type": "magiclink",
                "email": email,
                "options": {"redirectTo": f"{PUBLIC_SITE_URL}/profile"},
            },
        )
        if status != 200 or not isinstance(data, dict):
            return None
        return data.get("action_link")

    async def _ensure_discord_user(
        self, discord_user: discord.User, email_override: Optional[str] = None
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        profile = await self._get_profile_by_discord_id(discord_user.id)
        if profile:
            return profile, None

        if email_override:
            profile = await self._get_profile_by_email(email_override)
            if profile:
                updated = await self._update_profile_discord_link(
                    profile["user_id"], discord_user.id, discord_user.name
                )
                return updated or profile, None

        email = f"discord_{discord_user.id}@{DISCORD_EMAIL_DOMAIN}"
        existing = await self._get_profile_by_email(email)
        if existing:
            updated = await self._update_profile_discord_link(
                existing["user_id"], discord_user.id, discord_user.name
            )
            return updated or existing, None

        user_id = await self._create_auth_user(email, discord_user.id, discord_user.name)
        if not user_id:
            return None, "Failed to create Supabase user."

        updated = await self._update_profile_discord_link(
            user_id, discord_user.id, discord_user.name
        )
        if not updated:
            return None, "Failed to link Discord user to profile."

        return updated, None

    async def _get_verified_reddit_accounts(self, user_id: str) -> List[Dict[str, Any]]:
        status, data = await self.supabase.rest_request(
            "GET",
            "reddit_accounts",
            params={
                "select": "id,reddit_username,karma,karma_range,cqs,is_verified",
                "user_id": f"eq.{user_id}",
                "is_verified": "is.true",
                "order": "created_at.desc",
            },
        )
        if status != 200 or not data:
            return []
        return data

    async def _get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        status, data = await self.supabase.rest_request(
            "GET",
            "tasks",
            params={
                "select": "id,title,content,instruction,task_type,subreddit_flair,minimum_karma,cqs_levels,target_link,status,task_completion_time",
                "id": f"eq.{task_id}",
            },
        )
        if status != 200 or not data:
            return None
        return data[0]

    async def _get_open_assignment(self, task_id: str) -> Optional[Dict[str, Any]]:
        status, data = await self.supabase.rest_request(
            "GET",
            "task_assignments",
            params={
                "select": "id,user_id,status",
                "task_id": f"eq.{task_id}",
                "status": "in.(pending,in_progress,submitted)",
                "limit": "1",
            },
        )
        if status != 200 or not data:
            return None
        return data[0]

    async def _get_existing_assignment(self, task_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        status, data = await self.supabase.rest_request(
            "GET",
            "task_assignments",
            params={
                "select": "id,user_id,status",
                "task_id": f"eq.{task_id}",
                "user_id": f"eq.{user_id}",
                "limit": "1",
            },
        )
        if status != 200 or not data:
            return None
        return data[0]

    async def _get_task_rate(self, league: str, task_type: str) -> float:
        status, data = await self.supabase.rest_request(
            "GET",
            "task_type_rates",
            params={
                "select": "amount",
                "league": f"eq.{league}",
                "task_type": f"eq.{task_type}",
                "limit": "1",
            },
        )
        if status == 200 and data:
            try:
                return float(data[0]["amount"])
            except Exception:
                return 0.0
        return float(
            DEFAULT_TASK_TYPE_RATES_INR_BY_LEAGUE.get(league, {}).get(task_type, 0.0)
        )

    async def _create_assignment(
        self, task: Dict[str, Any], user_id: str, reddit_account: Dict[str, Any]
    ) -> Optional[str]:
        normalized = normalize_task_type(task.get("task_type"))
        league = compute_league(
            reddit_account.get("karma"),
            reddit_account.get("karma_range"),
            reddit_account.get("cqs"),
        )
        amount = await self._get_task_rate(league, normalized) if normalized else 0.0
        payload = {
            "task_id": task["id"],
            "user_id": user_id,
            "reddit_account_id": reddit_account["id"],
            "amount": amount,
            "status": "in_progress",
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
        status, data = await self.supabase.rest_request(
            "POST",
            "task_assignments",
            payload=payload,
            prefer="return=representation",
        )
        if status not in (200, 201) or not data:
            return None
        return data[0]["id"]

    async def _submit_assignment(self, task_id: str, user_id: str, url: str) -> bool:
        status, data = await self.supabase.rest_request(
            "PATCH",
            "task_assignments",
            params={"task_id": f"eq.{task_id}", "user_id": f"eq.{user_id}"},
            payload={
                "status": "submitted",
                "submitted_url": url,
                "submitted_at": datetime.now(timezone.utc).isoformat(),
            },
            prefer="return=representation",
        )
        return status in (200, 201) and bool(data)

    @app_commands.command(name="register", description="Link your Discord account and generate a website login link.")
    @app_commands.describe(email="Optional email if you already signed up on the website.")
    async def register(self, interaction: discord.Interaction, email: Optional[str] = None) -> None:
        if not self._guild_only(interaction):
            await interaction.response.send_message("This command only works in the main server.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)
        profile, error = await self._ensure_discord_user(interaction.user, email_override=email)
        if error or not profile:
            await interaction.followup.send(error or "Registration failed.", ephemeral=True)
            return

        magic_link = await self._generate_magic_link(profile["email"])
        if magic_link:
            try:
                await interaction.user.send(
                    "Your account is ready. Use this link to open your profile and complete Reddit verification:\n"
                    f"{magic_link}"
                )
                await interaction.followup.send(
                    "Linked. I sent you a private login link for the website.",
                    ephemeral=True,
                )
            except discord.Forbidden:
                await interaction.followup.send(
                    "Linked, but I could not DM you. Please enable DMs from server members and run /register again.",
                    ephemeral=True,
                )
        else:
            await interaction.followup.send(
                "Linked. Set `PUBLIC_SITE_URL` in the bot environment to receive a login link.",
                ephemeral=True,
            )

    @app_commands.command(name="me", description="Show your linked account and task stats.")
    async def me(self, interaction: discord.Interaction) -> None:
        if not self._guild_only(interaction):
            await interaction.response.send_message("This command only works in the main server.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)
        profile = await self._get_profile_by_discord_id(interaction.user.id)
        if not profile:
            await interaction.followup.send(
                "You are not linked yet. Run /register to create and link your account.",
                ephemeral=True,
            )
            return

        status, assignments = await self.supabase.rest_request(
            "GET",
            "task_assignments",
            params={
                "select": "status",
                "user_id": f"eq.{profile['user_id']}",
            },
        )
        total_assignments = len(assignments or []) if status == 200 else 0
        completed = len([a for a in (assignments or []) if a.get("status") == "completed"])

        status, payments = await self.supabase.rest_request(
            "GET",
            "payment_logs",
            params={
                "select": "amount",
                "worker_id": f"eq.{profile['user_id']}",
            },
        )
        total_paid = sum(float(p.get("amount") or 0) for p in (payments or [])) if status == 200 else 0.0

        await interaction.followup.send(
            f"Linked as `{profile['email']}`.\n"
            f"Assignments: {total_assignments} total, {completed} completed.\n"
            f"Paid total: INR {format_money(total_paid)}.",
            ephemeral=True,
        )

    @app_commands.command(name="tasks", description="List available tasks you can claim.")
    @app_commands.describe(limit="How many tasks to show (max 10).")
    async def tasks(self, interaction: discord.Interaction, limit: Optional[int] = 5) -> None:
        if not self._guild_only(interaction):
            await interaction.response.send_message("This command only works in the main server.", ephemeral=True)
            return

        limit = max(1, min(limit or 5, 10))
        await interaction.response.defer(ephemeral=True)
        status, data = await self.supabase.rest_request(
            "GET",
            "tasks",
            params={
                "select": "id,title,task_type,subreddit_flair,minimum_karma,cqs_levels,created_at",
                "status": "eq.pending",
                "order": "created_at.desc",
                "limit": str(limit),
            },
        )
        if status != 200 or not data:
            await interaction.followup.send("No pending tasks found.", ephemeral=True)
            return

        lines = []
        for task in data:
            flair = f" r/{task.get('subreddit_flair')}" if task.get("subreddit_flair") else ""
            lines.append(f"`{task['id']}` - {task.get('title', 'Untitled')}{flair}")

        await interaction.followup.send(
            "Pending tasks:\n" + "\n".join(lines),
            ephemeral=True,
        )

    @app_commands.command(name="claim", description="Claim a task and receive details via DM.")
    @app_commands.describe(task_id="Task ID to claim", reddit_username="Optional Reddit username to use")
    async def claim(
        self,
        interaction: discord.Interaction,
        task_id: str,
        reddit_username: Optional[str] = None,
    ) -> None:
        if not self._guild_only(interaction):
            await interaction.response.send_message("This command only works in the main server.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)
        profile = await self._get_profile_by_discord_id(interaction.user.id)
        if not profile:
            await interaction.followup.send(
                "You are not linked yet. Run /register first.",
                ephemeral=True,
            )
            return

        task = await self._get_task(task_id)
        if not task or task.get("status") != "pending":
            await interaction.followup.send("Task not found or no longer available.", ephemeral=True)
            return

        open_assignment = await self._get_open_assignment(task_id)
        if open_assignment and open_assignment.get("user_id") != profile["user_id"]:
            await interaction.followup.send("Task already claimed by another tasker.", ephemeral=True)
            return

        existing = await self._get_existing_assignment(task_id, profile["user_id"])
        if existing:
            await interaction.followup.send("You already attempted this task.", ephemeral=True)
            return

        reddit_accounts = await self._get_verified_reddit_accounts(profile["user_id"])
        if not reddit_accounts:
            await interaction.followup.send(
                "No verified Reddit account found. Use /register to get a website link and complete verification.",
                ephemeral=True,
            )
            return

        if reddit_username:
            reddit_username = reddit_username.strip().lower()
            matched = [a for a in reddit_accounts if (a.get("reddit_username") or "").lower() == reddit_username]
            if not matched:
                await interaction.followup.send(
                    "That Reddit username is not verified on your account.",
                    ephemeral=True,
                )
                return
            selected_account = matched[0]
        else:
            selected_account = reddit_accounts[0]

        min_karma = task.get("minimum_karma") or 0
        account_karma = selected_account.get("karma")
        account_karma_range = selected_account.get("karma_range")
        derived_karma = account_karma if isinstance(account_karma, int) else derive_karma_from_range(account_karma_range) or 0
        if derived_karma < min_karma:
            await interaction.followup.send(
                f"Task requires minimum karma {min_karma}. Your selected account does not meet this.",
                ephemeral=True,
            )
            return

        if not meets_minimum_cqs(selected_account.get("cqs"), task.get("cqs_levels")):
            await interaction.followup.send(
                "Your CQS level does not meet this task requirement.",
                ephemeral=True,
            )
            return

        assignment_id = await self._create_assignment(task, profile["user_id"], selected_account)
        if not assignment_id:
            await interaction.followup.send("Failed to claim task. Please try again.", ephemeral=True)
            return

        details = [
            f"Task: {task.get('title', 'Untitled')}",
            f"Task ID: {task['id']}",
            f"Task Type: {task.get('task_type')}",
        ]
        if task.get("subreddit_flair"):
            details.append(f"Subreddit: r/{task['subreddit_flair']}")
        if task.get("target_link"):
            details.append(f"Target Link: {task['target_link']}")
        if task.get("instruction"):
            details.append(f"Instruction: {task['instruction']}")
        if task.get("content"):
            details.append(f"Content: {task['content']}")

        try:
            await interaction.user.send("\n".join(details))
            await interaction.followup.send(
                "Task claimed. I sent you the details in DM.",
                ephemeral=True,
            )
        except discord.Forbidden:
            await interaction.followup.send(
                "Task claimed, but I could not DM you. Enable DMs to receive task details.",
                ephemeral=True,
            )

    @app_commands.command(name="submit", description="Submit a task completion link.")
    @app_commands.describe(task_id="Task ID to submit", url="Submission URL")
    async def submit(self, interaction: discord.Interaction, task_id: str, url: str) -> None:
        if not self._guild_only(interaction):
            await interaction.response.send_message("This command only works in the main server.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)
        profile = await self._get_profile_by_discord_id(interaction.user.id)
        if not profile:
            await interaction.followup.send(
                "You are not linked yet. Run /register first.",
                ephemeral=True,
            )
            return

        ok = await self._submit_assignment(task_id, profile["user_id"], url)
        if not ok:
            await interaction.followup.send("Could not submit. Check the task ID.", ephemeral=True)
            return

        await interaction.followup.send("Submission saved. Admin will review it.", ephemeral=True)

    @app_commands.command(name="admin_task_create", description="Create a task (admin only).")
    @app_commands.describe(
        title="Task title",
        content="Task content",
        instruction="Extra instructions",
        task_type="Task type (e.g. normal_comment)",
        subreddit_flair="Subreddit flair",
        minimum_karma="Minimum karma",
        cqs_levels="Comma-separated CQS levels (Low,Moderate,High,Highest)",
        target_link="Target link",
        completion_time="Completion time in minutes",
    )
    async def admin_task_create(
        self,
        interaction: discord.Interaction,
        title: str,
        content: Optional[str] = None,
        instruction: Optional[str] = None,
        task_type: Optional[str] = None,
        subreddit_flair: Optional[str] = None,
        minimum_karma: Optional[int] = 0,
        cqs_levels: Optional[str] = None,
        target_link: Optional[str] = None,
        completion_time: Optional[int] = 60,
    ) -> None:
        if not self._guild_only(interaction):
            await interaction.response.send_message("This command only works in the main server.", ephemeral=True)
            return

        if not await self._is_admin(interaction):
            await interaction.response.send_message("Not authorized.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)
        levels = []
        if cqs_levels:
            levels = [level.strip() for level in cqs_levels.split(",") if level.strip()]

        payload = {
            "title": title,
            "content": content,
            "instruction": instruction,
            "task_type": normalize_task_type(task_type) or task_type or "normal_comment",
            "subreddit_flair": subreddit_flair,
            "minimum_karma": int(minimum_karma or 0),
            "cqs_levels": levels or None,
            "target_link": target_link,
            "task_completion_time": int(completion_time or 60),
        }

        status, data = await self.supabase.rest_request(
            "POST",
            "tasks",
            payload=payload,
            prefer="return=representation",
        )
        if status not in (200, 201) or not data:
            await interaction.followup.send("Task creation failed.", ephemeral=True)
            return

        await interaction.followup.send(f"Task created: `{data[0]['id']}`", ephemeral=True)

    @app_commands.command(name="admin_user", description="Show a user's details by Discord mention (admin only).")
    async def admin_user(
        self, interaction: discord.Interaction, member: discord.Member
    ) -> None:
        if not self._guild_only(interaction):
            await interaction.response.send_message("This command only works in the main server.", ephemeral=True)
            return

        if not await self._is_admin(interaction):
            await interaction.response.send_message("Not authorized.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)
        profile = await self._get_profile_by_discord_id(member.id)
        if not profile:
            await interaction.followup.send("User not linked.", ephemeral=True)
            return

        status, reddit_accounts = await self.supabase.rest_request(
            "GET",
            "reddit_accounts",
            params={
                "select": "reddit_username,is_verified,karma,karma_range,cqs",
                "user_id": f"eq.{profile['user_id']}",
                "order": "created_at.desc",
            },
        )
        account_lines = []
        if status == 200 and reddit_accounts:
            for account in reddit_accounts[:5]:
                account_lines.append(
                    f"u/{account.get('reddit_username')} | verified={account.get('is_verified')}"
                )

        await interaction.followup.send(
            "User profile:\n"
            f"Email: `{profile['email']}`\n"
            f"Name: `{profile.get('full_name') or '-'}`\n"
            f"Discord: `{profile.get('discord_username') or member.name}`\n"
            + ("Reddit:\n" + "\n".join(account_lines) if account_lines else "Reddit: none"),
            ephemeral=True,
        )

    @app_commands.command(name="admin_payments", description="List recent payments (admin only).")
    @app_commands.describe(member="Optional Discord user to filter")
    async def admin_payments(
        self, interaction: discord.Interaction, member: Optional[discord.Member] = None
    ) -> None:
        if not self._guild_only(interaction):
            await interaction.response.send_message("This command only works in the main server.", ephemeral=True)
            return

        if not await self._is_admin(interaction):
            await interaction.response.send_message("Not authorized.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)
        params = {
            "select": "paid_at,amount,transaction_id,worker_name,worker_email",
            "order": "paid_at.desc",
            "limit": "10",
        }
        if member:
            profile = await self._get_profile_by_discord_id(member.id)
            if not profile:
                await interaction.followup.send("User not linked.", ephemeral=True)
                return
            params["worker_id"] = f"eq.{profile['user_id']}"

        status, payments = await self.supabase.rest_request("GET", "payment_logs", params=params)
        if status != 200 or not payments:
            await interaction.followup.send("No payment logs found.", ephemeral=True)
            return

        lines = []
        for row in payments:
            lines.append(
                f"{row.get('paid_at', '')[:10]} | INR {format_money(row.get('amount'))} | {row.get('worker_name') or row.get('worker_email') or '-'} | {row.get('transaction_id')}"
            )

        await interaction.followup.send("Payments:\n" + "\n".join(lines), ephemeral=True)

    @app_commands.command(name="admin_history", description="Show recent activity logs (admin only).")
    @app_commands.describe(member="Discord user to inspect")
    async def admin_history(
        self, interaction: discord.Interaction, member: discord.Member
    ) -> None:
        if not self._guild_only(interaction):
            await interaction.response.send_message("This command only works in the main server.", ephemeral=True)
            return

        if not await self._is_admin(interaction):
            await interaction.response.send_message("Not authorized.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)
        profile = await self._get_profile_by_discord_id(member.id)
        if not profile:
            await interaction.followup.send("User not linked.", ephemeral=True)
            return

        status, logs = await self.supabase.rest_request(
            "GET",
            "activity_logs",
            params={
                "select": "created_at,action,entity_type,entity_id",
                "user_id": f"eq.{profile['user_id']}",
                "order": "created_at.desc",
                "limit": "10",
            },
        )
        if status != 200 or not logs:
            await interaction.followup.send("No activity logs found.", ephemeral=True)
            return

        lines = []
        for row in logs:
            timestamp = (row.get("created_at") or "")[:19].replace("T", " ")
            lines.append(
                f"{timestamp} | {row.get('action')} | {row.get('entity_type') or '-'}"
            )

        await interaction.followup.send("Recent activity:\n" + "\n".join(lines), ephemeral=True)



    @app_commands.command(
        name="adminhub_help",
        description="Show admin-only help for Admin Hub Discord commands.",
    )
    async def adminhub_help(self, interaction: discord.Interaction) -> None:
        if not self._guild_only(interaction):
            await interaction.response.send_message("This command only works in the main server.", ephemeral=True)
            return

        if not await self._is_admin(interaction):
            await interaction.response.send_message("Not authorized.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)

        help_lines = [
            "**Admin Hub Cog Help (Admins Only)**",
            "",
            "User commands:",
            "`/register [email]` - Link Discord -> website account, DM login link.",
            "`/me` - Show linked account + assignment/payment stats.",
            "`/tasks [limit]` - List pending tasks.",
            "`/claim <task_id> [reddit_username]` - Claim a task and DM details.",
            "`/submit <task_id> <url>` - Submit proof link for a task.",
            "",
            "Admin commands:",
            "`/admin_task_create` - Create a task from Discord.",
            "`/admin_user @member` - Show a user's profile + Reddit accounts.",
            "`/admin_payments [@member]` - Show recent payment logs.",
            "`/admin_history @member` - Show recent activity logs.",
            "",
            "Account linking flow:",
            "1) Website Discord OAuth sets `profiles.discord_user_id` + `discord_username`.",
            "2) `/register` links by Discord ID, or by email if provided.",
            "3) If no account exists, `/register` creates one and links Discord ID.",
            "",
            "Notes:",
            "- Commands are restricted to the main server only.",
            "- Admin access is limited to the configured Discord role IDs (and optional user IDs).",
        ]

        await interaction.followup.send("\n".join(help_lines), ephemeral=True)

    @app_commands.command(
        name="adminhub_debug",
        description="Debug admin role checks for Admin Hub (server-only).",
    )
    async def adminhub_debug(self, interaction: discord.Interaction) -> None:
        if not self._guild_only(interaction):
            await interaction.response.send_message("This command only works in the main server.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)

        member = None
        if interaction.guild is not None:
            member = interaction.guild.get_member(interaction.user.id)

        member_role_ids = [role.id for role in (member.roles if member else [])]
        is_admin = await self._is_admin(interaction)

        lines = [
            f"Server ID: {interaction.guild_id}",
            f"Your User ID: {interaction.user.id}",
            f"Your Role IDs: {member_role_ids}",
            f"Configured Admin Role IDs: {sorted(ADMIN_ROLE_IDS)}",
            f"Configured Admin User IDs: {sorted(ADMIN_USER_IDS)}",
            f"Is Admin: {is_admin}",
        ]

        await interaction.followup.send("\n".join(lines), ephemeral=True)
async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(AdminHubCog(bot))