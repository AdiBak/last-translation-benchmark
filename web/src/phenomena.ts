import './assets/style.css';
import $ from 'jquery';
import { getMe, renderRoleSwitcher } from './api';
import { renderHeaderStatus } from './utils';

type Cell = { pass: number; n: number; rate: number | null };
type Bucket = { n_examples: number; models: Record<string, Cell> };
type TagRow = {
    tag: string;
    group: string;
    n: number;
    models: Record<string, Cell>;
    by_direction: Record<string, Bucket>;
};
type AdjustedModel = { n_tags: number; tags: string[]; by_direction: Record<string, number | null> };
type Payload = {
    subset: string;
    verifier: string;
    n_examples: number;
    directions: { id: string; label: string }[];
    models: string[];
    overall: Record<string, Cell>;
    by_direction: Record<string, Bucket>;
    tags: TagRow[];
    adjusted: { min_n: number; models: Record<string, AdjustedModel> };
};

const DEFAULT_MODELS = ["Gemini 3.1 Pro", "GPT-5.6 Sol", "TranslateGemma"];
const MODEL_COLOR: Record<string, string> = {
    "Gemini 3.1 Pro": "#1a1a1a",
    "GPT-5.6 Sol": "#d64545",
    "GPT-5.6 Luna": "#7b3fa0",
    "Gemma 4": "#2e9e4f",
    "TranslateGemma": "#e39b12",
    "Tower+": "#2b7de9",
    "Seed-X-PPO-7B": "#e07a2f",
    "HY-MT2": "#1a9a96",
    "Command A Translate": "#c44b7a",
    "NLLB 3.3B": "#8a6a2f",
    "Google Translate": "#5c4ad4",
};

let payload: Payload;

function pct(rate: number | null | undefined): string {
    if (rate == null || Number.isNaN(rate)) return "—";
    return `${(rate * 100).toFixed(1)}%`;
}

function esc(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function selectedModels(): string[] {
    const chosen: string[] = [];
    $("#model-checks input:checked").each(function () {
        chosen.push(String($(this).val()));
    });
    return chosen;
}

function color(model: string): string {
    return MODEL_COLOR[model] || "#333333";
}

function labelWidth(text: string): number {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return text.length * 7;
    ctx.font = "12px Inter, sans-serif";
    return ctx.measureText(text).width;
}

function legendRows(models: string[], left: number, right: number): { model: string; x: number; y: number; bottom: number }[] {
    const rowH = 20;
    let x = left;
    let y = 16;
    const items = [];
    for (const model of models) {
        const itemW = 12 + 8 + labelWidth(model) + 16;
        if (x > left && x + itemW > right) {
            x = left;
            y += rowH;
        }
        items.push({ model, x, y, bottom: y + 6 });
        x += itemW;
    }
    return items;
}

function renderPhenomena() {
    const models = selectedModels();
    const minN = parseInt(String($("#min-n").val()), 10);
    const focus = models[0];
    const tags = payload.tags
        .filter(tag => tag.n >= minN && tag.group !== "Blocker")
        .sort((a, b) => (a.models[focus]?.rate ?? 1) - (b.models[focus]?.rate ?? 1));

    const chart = $("#phenomena-chart");
    chart.empty();
    if (models.length === 0 || tags.length === 0) {
        chart.html('<div class="empty">No phenomena match the selected filters.</div>');
        $("#phenomena-table").empty();
        return;
    }

    const barH = 11;
    const band = models.length * (barH + 3) + 10;
    const w = chart.width() || 900;
    const legend = legendRows(models, 12, w - 12);
    const legendBottom = legend.length ? legend[legend.length - 1].bottom : 16;
    const padding = { top: legendBottom + 18, right: 24, bottom: 46, left: 220 };
    const h = padding.top + padding.bottom + tags.length * band;
    const innerW = w - padding.left - padding.right;
    const scaleX = (rate: number) => padding.left + rate * innerW;

    let svg = `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" style="background:#ddd;">`;
    for (const item of legend) {
        svg += `<rect x="${item.x}" y="${item.y - 10}" width="12" height="12" fill="${color(item.model)}"/>`;
        svg += `<text x="${item.x + 18}" y="${item.y}" font-size="12" fill="black">${esc(item.model)}</text>`;
    }
    svg += `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${h - padding.bottom}" stroke="black" stroke-width="2"/>`;
    svg += `<line x1="${padding.left}" y1="${h - padding.bottom}" x2="${w - padding.right}" y2="${h - padding.bottom}" stroke="black" stroke-width="2"/>`;
    svg += `<text x="${padding.left + innerW / 2}" y="${h - 14}" text-anchor="middle" font-size="13" font-weight="bold" fill="black">Pass rate (%)</text>`;
    for (const tick of [0, 0.25, 0.5, 0.75, 1]) {
        const x = scaleX(tick);
        svg += `<line x1="${x}" y1="${h - padding.bottom}" x2="${x}" y2="${h - padding.bottom + 5}" stroke="black"/>`;
        svg += `<text x="${x}" y="${h - padding.bottom + 20}" text-anchor="middle" font-size="12" fill="black">${Math.round(tick * 100)}</text>`;
    }

    tags.forEach((tag, index) => {
        const top = padding.top + index * band;
        svg += `<text x="${padding.left - 8}" y="${top + band / 2}" text-anchor="end" font-size="12" fill="black">${esc(tag.tag)}</text>`;
        models.forEach((model, modelIndex) => {
            const cell = tag.models[model];
            const rate = cell?.rate ?? 0;
            const y = top + 6 + modelIndex * (barH + 3);
            const width = Math.max(0, (cell?.n ? rate : 0) * innerW);
            svg += `<rect class="phen-bar" data-tag="${esc(tag.tag)}" data-model="${esc(model)}" x="${padding.left}" y="${y}" width="${width}" height="${barH}" fill="${color(model)}"/>`;
        });
    });
    svg += `</svg>`;
    chart.css("height", `${h}px`).html(svg);

    const tooltip = $("#phenomena-tooltip");
    chart.find(".phen-bar").on("mouseenter", function (event) {
        const tagName = $(this).attr("data-tag") || "";
        const model = $(this).attr("data-model") || "";
        const tag = tags.find(row => row.tag === tagName);
        const cell = tag?.models[model];
        tooltip.html(`<strong>${esc(tagName)}</strong><br>${esc(model)}<br>${pct(cell?.rate)} of ${cell?.n ?? 0}`);
        tooltip.show().css({ left: `${event.clientX}px`, top: `${event.clientY + 16}px` });
    }).on("mousemove", function (event) {
        tooltip.css({ left: `${event.clientX}px`, top: `${event.clientY + 16}px` });
    }).on("mouseleave", function () {
        tooltip.hide();
    });

    let rows = "";
    for (const tag of tags) {
        const cells = models.map(model => `<td class="num">${pct(tag.models[model]?.rate)}</td>`).join("");
        rows += `<tr><td>${esc(tag.tag)}</td><td>${esc(tag.group)}</td><td class="num">${tag.n}</td>${cells}</tr>`;
    }
    const heads = models.map(model => `<th class="num">${esc(model)}</th>`).join("");
    $("#phenomena-table").html(`<table class="rates"><tr><th>Phenomenon</th><th>Group</th><th class="num">Examples</th>${heads}</tr>${rows}</table>`);
}

function renderDirection() {
    const model = String($("#direction-model").val());
    const adjusted = payload.adjusted.models[model];
    const chart = $("#direction-chart");
    chart.empty();
    if (!adjusted) {
        $("#direction-table").empty();
        return;
    }

    const padding = { top: 36, right: 24, bottom: 48, left: 56 };
    const w = chart.width() || 900;
    const h = 280;
    const innerW = w - padding.left - padding.right;
    const innerH = h - padding.top - padding.bottom;
    const scaleY = (rate: number) => padding.top + innerH - rate * innerH;
    const slot = innerW / payload.directions.length;

    let svg = `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" style="background:#ddd;">`;
    svg += `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + innerH}" stroke="black" stroke-width="2"/>`;
    svg += `<line x1="${padding.left}" y1="${padding.top + innerH}" x2="${w - padding.right}" y2="${padding.top + innerH}" stroke="black" stroke-width="2"/>`;
    svg += `<text x="16" y="${padding.top + innerH / 2}" text-anchor="middle" font-size="13" font-weight="bold" fill="black" transform="rotate(-90 16 ${padding.top + innerH / 2})">Pass rate (%)</text>`;
    for (const tick of [0, 0.25, 0.5, 0.75, 1]) {
        const y = scaleY(tick);
        svg += `<line x1="${padding.left - 5}" y1="${y}" x2="${padding.left}" y2="${y}" stroke="black"/>`;
        svg += `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="12" fill="black">${Math.round(tick * 100)}</text>`;
    }
    svg += `<text x="${w - padding.right - 150}" y="20" font-size="12" fill="black">■ Raw</text>`;
    svg += `<text x="${w - padding.right - 90}" y="20" font-size="12" fill="#aa3333">■ Same tag mix</text>`;

    payload.directions.forEach((direction, index) => {
        const raw = payload.by_direction[direction.id]?.models[model]?.rate ?? 0;
        const mix = adjusted.by_direction[direction.id] ?? 0;
        const x = padding.left + index * slot + slot * 0.25;
        const barW = slot * 0.2;
        const rawH = raw * innerH;
        const mixH = mix * innerH;
        svg += `<rect x="${x}" y="${scaleY(raw)}" width="${barW}" height="${rawH}" fill="#111"/>`;
        svg += `<rect x="${x + barW + 6}" y="${scaleY(mix)}" width="${barW}" height="${mixH}" fill="#aa3333"/>`;
        svg += `<text x="${x + barW}" y="${h - 16}" text-anchor="middle" font-size="12" fill="black">${esc(direction.label)}</text>`;
    });
    svg += `</svg>`;
    chart.css("height", `${h}px`).html(svg);

    const tagByName = new Map(payload.tags.map(tag => [tag.tag, tag]));
    let rows = "";
    for (const tagName of adjusted.tags) {
        const tag = tagByName.get(tagName);
        if (!tag) continue;
        const cells = payload.directions.map(direction => {
            const bucket = tag.by_direction[direction.id];
            const cell = bucket?.models[model];
            return `<td class="num">${pct(cell?.rate)} <span style="color:#64748b">(${cell?.n ?? 0})</span></td>`;
        }).join("");
        rows += `<tr><td>${esc(tag.tag)}</td>${cells}</tr>`;
    }
    const heads = payload.directions.map(direction => `<th class="num">${esc(direction.label)}</th>`).join("");
    $("#direction-table").html(
        `<p class="note">${adjusted.n_tags} tags meet the cutoff for ${esc(model)}. The number in parentheses is how many translations were scored.</p>` +
        `<table class="rates"><tr><th>Phenomenon</th>${heads}</tr>${rows}</table>`
    );
}

async function main() {
    const response = await fetch("assets/phenomena.json");
    payload = await response.json();

    const checks = $("#model-checks");
    for (const model of payload.models) {
        const id = `model-${model.replace(/[^a-z0-9]+/gi, "-")}`;
        const checked = DEFAULT_MODELS.includes(model) ? "checked" : "";
        checks.append(
            `<label for="${id}"><input type="checkbox" id="${id}" value="${esc(model)}" ${checked}>` +
            `<span style="color:${color(model)}">${esc(model)}</span></label>`
        );
    }
    const select = $("#direction-model");
    for (const model of DEFAULT_MODELS) {
        select.append(`<option value="${esc(model)}">${esc(model)}</option>`);
    }

    $("#model-checks input, #min-n").on("change", renderPhenomena);
    $("#direction-model").on("change", renderDirection);
    renderPhenomena();
    renderDirection();
}

$(async () => {
    try {
        const user = await getMe();
        if (user) {
            renderHeaderStatus(user);
            renderRoleSwitcher(user.roles);
        }
    } catch {
        // Not logged in, ignore
    }
    try {
        await main();
    } catch (error) {
        $("#phenomena-chart").html(`<div class="empty">Failed to load phenomenon rates: ${error}</div>`);
    }
});
