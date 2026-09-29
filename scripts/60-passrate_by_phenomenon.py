"""Pass rates on LTBv1-eval by linguistic tag and by translation direction.

Reads data/v1.json. The `verified` flags match the Gemini 3.1 Pro column of
Main Table 2. An example counts toward every tag it carries. Empty translations
are left out of that model's count.

    python3 scripts/60-passrate_by_phenomenon.py
"""

import collections
import json
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)) + "/..")

DATA_FILE = "data/v1.json"
OUT_FILE = "computed/passrate_by_phenomenon.json"
SITE_FILE = "web/src/assets/phenomena.json"

DIRECTIONS = ("en→x", "x→en", "x→y")
DIRECTION_LABELS = {
    "en→x": "English → other",
    "x→en": "Other → English",
    "x→y": "Other → other",
}
# a tag is used in the adjusted rate only if every direction has at least this
# many translations from that model
ADJUST_MIN_N = 8

# printed in this order, human is included so the ceiling is visible
MODELS = [
    "human",
    "Gemini 3.1 Pro",
    "GPT-5.6 Sol",
    "GPT-5.6 Luna",
    "Gemma 4",
    "TranslateGemma",
    "Tower+",
    "Seed-X-PPO-7B",
    "HY-MT2",
    "Command A Translate",
    "NLLB 3.3B",
    "Google Translate",
]

# tag groups from Table 6, broad-level tags are left out of the site chart
TAG_GROUP = {
    "Polysemy": "Sense",
    "Collocation": "Sense",
    "Style Preservation": "Sense",
    "Domain Preservation": "Sense",
    "Lexical Gradation": "Sense",
    "Variant Specifics": "Non-monolingual",
    "False Friends": "Non-monolingual",
    "Target Gap: Words to Phrases": "Non-monolingual",
    "Target Gap: Morph to Words": "Non-monolingual",
    "Target Gap: Not to be Translated": "Non-monolingual",
    "Code-mixing": "Non-monolingual",
    "Metaphor": "Non-compositional",
    "Wordplay": "Non-compositional",
    "Meta Reasoning": "Non-compositional",
    "Poetry": "Non-compositional",
    "Gardenpath": "Atypical",
    "Induced Confusion": "Atypical",
    "Part of Speech": "Atypical",
    "Cultural Artifact": "Knowledge",
    "Conventions": "Knowledge",
    "Slang": "Knowledge",
    "Named Entity": "Knowledge",
    "Internet Cultural Artifact": "Knowledge",
    "Output: Language": "Constraint",
    "Input: Format": "Constraint",
    "Irrelevant": "Blocker",
    "Incomplete": "Blocker",
    "Refusal": "Blocker",
    "Tokenization": "Blocker",
    "Semantic/Lexical": "Broad level",
    "Pragmatic": "Broad level",
    "Morphological": "Broad level",
    "Orthography": "Broad level",
    "Syntactic": "Broad level",
    "Phonological": "Broad level",
}


def direction(submission: dict) -> str:
    source = submission["source_lang"].split("(")[0].strip()
    target = submission["target_lang"].split("(")[0].strip()
    if source == "English" and target == "English":
        return "en→en"
    if source == "English":
        return "en→x"
    if target == "English":
        return "x→en"
    return "x→y"


def first_translation(submission: dict, model: str) -> dict | None:
    for entry in submission["translations"]:
        if entry["model"] == model:
            return entry
    return None


# none when the model produced no translation
def is_pass(entry: dict | None) -> bool | None:
    if entry is None or not entry["translation"]:
        return None
    return all(entry["verified"])


def accumulate(bucket: dict, submission: dict) -> None:
    bucket["n_examples"] += 1
    for model in MODELS:
        outcome = is_pass(first_translation(submission, model))
        if outcome is None:
            continue
        stats = bucket["models"][model]
        stats["n"] += 1
        stats["pass"] += int(outcome)


def empty_bucket() -> dict:
    return {
        "n_examples": 0,
        "models": {model: {"pass": 0, "n": 0} for model in MODELS},
    }


def with_rates(bucket: dict) -> dict:
    models = {}
    for model, stats in bucket["models"].items():
        rate = stats["pass"] / stats["n"] if stats["n"] else None
        models[model] = {**stats, "rate": rate}
    return {"n_examples": bucket["n_examples"], "models": models}


def is_specific(tag: str) -> bool:
    return TAG_GROUP.get(tag, "Uncategorized") not in {"Broad level", "Uncategorized"}


def adjusted_by_model(by_tag_direction: dict) -> dict:
    # score every direction on the same tags
    # skip a tag when this model has fewer than ADJUST_MIN_N translations in any direction
    # weight each tag by how many eval examples carry it
    out = {}
    for model in MODELS:
        weighted_sum = {name: 0.0 for name in DIRECTIONS}
        weight_total = 0
        tags_used = []
        for tag, by_direction in by_tag_direction.items():
            if not is_specific(tag):
                continue
            counts = [by_direction[name]["models"][model]["n"] for name in DIRECTIONS]
            if any(count < ADJUST_MIN_N for count in counts):
                continue
            weight = sum(by_direction[name]["n_examples"] for name in DIRECTIONS)
            weight_total += weight
            tags_used.append(tag)
            for name in DIRECTIONS:
                stats = by_direction[name]["models"][model]
                weighted_sum[name] += weight * (stats["pass"] / stats["n"])
        rates = {}
        for name in DIRECTIONS:
            if weight_total == 0:
                rates[name] = None
            else:
                rates[name] = weighted_sum[name] / weight_total
        out[model] = {
            "n_tags": len(tags_used),
            "tags": tags_used,
            "by_direction": rates,
        }
    return out


def site_payload(report: dict, by_tag_direction: dict) -> dict:
    tags = []
    for tag, bucket in report["by_tag"].items():
        if not is_specific(tag):
            continue
        tags.append({
            "tag": tag,
            "group": bucket["group"],
            "n": bucket["n_examples"],
            "models": bucket["models"],
            "by_direction": {
                name: with_rates(by_tag_direction[tag][name]) for name in DIRECTIONS
            },
        })
    return {
        "subset": report["subset"],
        "verifier": "Gemini 3.1 Pro",
        "n_examples": report["n_examples"],
        "directions": [
            {"id": name, "label": DIRECTION_LABELS[name]} for name in DIRECTIONS
        ],
        "models": [model for model in MODELS if model != "human"],
        "overall": report["overall"]["models"],
        "by_direction": report["by_direction"],
        "tags": tags,
        "adjusted": {
            "min_n": ADJUST_MIN_N,
            "models": report["adjusted"],
        },
    }


def main() -> None:
    with open(DATA_FILE) as f:
        data = json.load(f)
    eval_data = [row for row in data if "LTBv1-eval" in row["tags"]]

    overall = empty_bucket()
    by_tag = collections.defaultdict(empty_bucket)
    by_direction = collections.defaultdict(empty_bucket)
    by_tag_direction = collections.defaultdict(lambda: collections.defaultdict(empty_bucket))
    for submission in eval_data:
        example_direction = direction(submission)
        accumulate(overall, submission)
        accumulate(by_direction[example_direction], submission)
        for tag in submission["linguistics"] or []:
            accumulate(by_tag[tag], submission)
            if example_direction in DIRECTIONS:
                accumulate(by_tag_direction[tag][example_direction], submission)

    report = {
        "subset": "LTBv1-eval",
        "verifier": "Gemini 3.1 Pro",
        "n_examples": len(eval_data),
        "note": "Tags are multi-label. Rates use only non-empty translations.",
        "overall": with_rates(overall),
        "by_direction": {key: with_rates(value) for key, value in sorted(by_direction.items())},
        "by_tag": {
            tag: {
                **with_rates(bucket),
                "group": TAG_GROUP.get(tag, "Uncategorized"),
                "by_direction": {
                    name: with_rates(by_tag_direction[tag][name]) for name in DIRECTIONS
                },
            }
            for tag, bucket in sorted(by_tag.items(), key=lambda item: -item[1]["n_examples"])
        },
        "adjusted": adjusted_by_model(by_tag_direction),
    }

    os.makedirs("computed", exist_ok=True)
    os.makedirs(os.path.dirname(SITE_FILE), exist_ok=True)
    with open(OUT_FILE, "w") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
        f.write("\n")
    with open(SITE_FILE, "w") as f:
        json.dump(site_payload(report, by_tag_direction), f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"LTBv1-eval  n={report['n_examples']}  verifier={report['verifier']}")
    print(f"wrote {OUT_FILE}")
    print(f"wrote {SITE_FILE}")
    focus = "Gemini 3.1 Pro"
    print()
    print(f"Direction, raw vs tag-mix-adjusted ({focus}, tags with n>={ADJUST_MIN_N} in every direction)")
    print(f"{'direction':<22} {'raw':>8} {'adjusted':>10} {'tags':>6}")
    for name in DIRECTIONS:
        raw = report["by_direction"][name]["models"][focus]["rate"]
        adjusted = report["adjusted"][focus]["by_direction"][name]
        print(
            f"{DIRECTION_LABELS[name]:<22} {100 * raw:7.1f}% {100 * adjusted:9.1f}% "
            f"{report['adjusted'][focus]['n_tags']:6d}"
        )
    print()
    print(f"{'model':<24} {'pass%':>7} {'n':>6}")
    for model in MODELS:
        stats = report["overall"]["models"][model]
        rate = 100 * stats["rate"] if stats["rate"] is not None else float("nan")
        print(f"{model:<24} {rate:6.1f}% {stats['n']:6d}")

    focus = "Gemini 3.1 Pro"
    print()
    print(f"Specific phenomena, sorted by {focus} pass rate (n>=20)")
    print(f"{'tag':<36} {'group':<18} {'n':>5} {focus:>8} {'GPT-5.6 Sol':>12} {'TranslateGemma':>15}")
    rows = []
    for tag, bucket in report["by_tag"].items():
        if bucket["group"] in {"Broad level", "Uncategorized"}:
            continue
        if bucket["n_examples"] < 20:
            continue
        rows.append((bucket["models"][focus]["rate"] or 0, tag, bucket))
    for _, tag, bucket in sorted(rows):
        def pct(model: str, bucket: dict = bucket) -> str:
            stats = bucket["models"][model]
            if not stats["n"]:
                return "-"
            return f"{100 * stats['rate']:5.1f}%"

        print(
            f"{tag:<36} {bucket['group']:<18} {bucket['n_examples']:5d} "
            f"{pct(focus):>8} {pct('GPT-5.6 Sol'):>12} {pct('TranslateGemma'):>15}"
        )


if __name__ == "__main__":
    main()
