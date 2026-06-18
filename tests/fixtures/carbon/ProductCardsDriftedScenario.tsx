import { useState } from "react";
import {
  Tile,
  Tag,
  Button,
  IconButton,
  AspectRatio,
  Grid,
  Column,
  Stack,
} from "@carbon/react";
import {
  ShoppingCart,
  Bookmark,
  BookmarkFilled,
  StarFilled,
  Star,
  OverflowMenuVertical,
} from "@carbon/icons-react";

// ─── Shared data ─────────────────────────────────────────────────────────────

interface Product {
  name: string;
  category: string;
  description: string;
  price: number;
  originalPrice: number;
  rating: number;
  reviewCount: number;
  imageBg: string;
}

const headphones: Product = {
  name: "Wireless Headphones Pro",
  category: "Audio",
  description:
    "Premium noise-cancelling headphones with 40-hour battery life and spatial audio support.",
  price: 149.99,
  originalPrice: 199.99,
  rating: 4.5,
  reviewCount: 128,
  imageBg: "linear-gradient(135deg, #0f62fe 0%, #4589ff 100%)",
};

const keyboard: Product = {
  name: "Mechanical Keyboard TKL",
  category: "Peripherals",
  description:
    "Tenkeyless layout with hot-swappable switches, per-key RGB, and USB-C connectivity.",
  price: 89.99,
  originalPrice: 119.99,
  rating: 4.8,
  reviewCount: 243,
  imageBg: "linear-gradient(135deg, #393939 0%, #6f6f6f 100%)",
};

const hub: Product = {
  name: "USB-C Hub 9-in-1",
  category: "Accessories",
  description:
    "Expand your ports with HDMI 4K, 3× USB-A, SD card, Ethernet, and 100W pass-through.",
  price: 59.99,
  originalPrice: 79.99,
  rating: 4.2,
  reviewCount: 87,
  imageBg: "linear-gradient(135deg, #007d79 0%, #08bdba 100%)",
};

// ─── Shared helpers ───────────────────────────────────────────────────────────

function StarRating({ value, reviewCount }: { value: number; reviewCount: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      {Array.from({ length: 5 }, (_, i) =>
        i < Math.floor(value) ? (
          <StarFilled key={i} size={14} style={{ color: "#f1c21b" }} />
        ) : (
          <Star key={i} size={14} style={{ color: "#8d8d8d" }} />
        )
      )}
      <span style={{ marginLeft: 4, fontSize: 12, color: "#6f6f6f" }}>
        {value} ({reviewCount})
      </span>
    </div>
  );
}

// ─── Custom components ────────────────────────────────────────────────────────

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#f4f4f4",
        border: "1px solid #e0e0e0",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

function PillBadge({
  children,
  variant = "red",
}: {
  children: React.ReactNode;
  variant?: "red" | "green" | "teal" | "blue";
}) {
  const palette = {
    red: { bg: "#fff1f1", color: "#da1e28" },
    green: { bg: "#defbe6", color: "#198038" },
    teal: { bg: "#d9fbfb", color: "#005d5d" },
    blue: { bg: "#edf5ff", color: "#0043ce" },
  };
  const { bg, color } = palette[variant];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0 10px",
        height: 22,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        background: bg,
        color,
        borderRadius: 11,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function GhostIconBtn({
  label,
  children,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        padding: 0,
        border: "none",
        background: "transparent",
        color: "#161616",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function PromoStrip({ text }: { text: string }) {
  return (
    <div
      style={{
        background: "#fff8e1",
        borderBottom: "1px solid #f1c21b",
        padding: "6px 12px",
        fontSize: 12,
        fontWeight: 500,
        color: "#161616",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span style={{ fontSize: 14 }}>⚡</span>
      {text}
    </div>
  );
}

function StepperInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const btn: React.CSSProperties = {
    width: 40,
    height: 40,
    border: "none",
    background: "#e0e0e0",
    cursor: "pointer",
    fontSize: 18,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };
  return (
    <div style={{ display: "inline-flex", alignItems: "stretch", border: "1px solid #8d8d8d" }}>
      <button style={btn} onClick={() => onChange(Math.max(1, value - 1))}>
        −
      </button>
      <span
        style={{
          width: 44,
          textAlign: "center",
          fontSize: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderLeft: "1px solid #8d8d8d",
          borderRight: "1px solid #8d8d8d",
        }}
      >
        {value}
      </span>
      <button style={btn} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

function DropMenu({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        aria-label="More options"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          color: "#161616",
        }}
      >
        <OverflowMenuVertical size={16} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "100%",
            background: "#ffffff",
            boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
            minWidth: 160,
            zIndex: 200,
          }}
        >
          {items.map((item) => (
            <button
              key={item}
              onClick={() => setOpen(false)}
              style={{
                display: "block",
                width: "100%",
                padding: "10px 16px",
                textAlign: "left",
                border: "none",
                background: "transparent",
                fontSize: 14,
                cursor: "pointer",
                color: "#161616",
              }}
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StockDot({ count }: { count: number }) {
  const low = count <= 5;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}>
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: low ? "#ff832b" : "#24a148",
          flexShrink: 0,
        }}
      />
      <span style={{ color: low ? "#ba4e00" : "#198038" }}>
        {low ? `Only ${count} left` : "In stock"}
      </span>
    </div>
  );
}

// ─── Variant 4 ────────────────────────────────────────────────────────────────

function Variant4({ p }: { p: Product }) {
  const [saved, setSaved] = useState(false);
  return (
    <CardShell>
      <AspectRatio ratio="4x3">
        <div style={{ background: p.imageBg, width: "100%", height: "100%" }} />
      </AspectRatio>
      <div style={{ padding: "1rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "0.75rem",
          }}
        >
          <PillBadge variant="red">Sale</PillBadge>
          <GhostIconBtn label={saved ? "Remove from wishlist" : "Save"} onClick={() => setSaved(!saved)}>
            {saved ? <BookmarkFilled size={16} /> : <Bookmark size={16} />}
          </GhostIconBtn>
        </div>
        <p className="cds--productive-heading-02" style={{ marginBottom: "0.25rem" }}>
          {p.name}
        </p>
        <p style={{ fontSize: 12, color: "#6f6f6f", marginBottom: "0.75rem" }}>{p.category}</p>
        <StarRating value={p.rating} reviewCount={p.reviewCount} />
        <div style={{ margin: "0.75rem 0", borderTop: "1px solid #e0e0e0" }} />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <span style={{ fontSize: 20, fontWeight: 600 }}>${p.price}</span>
            <span style={{ fontSize: 12, color: "#6f6f6f", textDecoration: "line-through", marginLeft: 6 }}>
              ${p.originalPrice}
            </span>
          </div>
          <Button size="sm" renderIcon={ShoppingCart}>
            Add to cart
          </Button>
        </div>
      </div>
    </CardShell>
  );
}

// ─── Variant 5 ────────────────────────────────────────────────────────────────

function Variant5({ p }: { p: Product }) {
  const [qty, setQty] = useState(1);
  const [saved, setSaved] = useState(false);
  return (
    <Tile style={{ padding: 0, overflow: "hidden" }}>
      <PromoStrip text="Flash sale — ends in 2h 14m" />
      <AspectRatio ratio="16x9">
        <div style={{ background: p.imageBg, width: "100%", height: "100%" }} />
      </AspectRatio>
      <div style={{ padding: "1rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "0.75rem",
          }}
        >
          <div style={{ display: "flex", gap: 6 }}>
            <Tag type="red">Sale</Tag>
            <Tag type="green">In stock</Tag>
          </div>
          <IconButton
            label={saved ? "Remove from wishlist" : "Save to wishlist"}
            kind="ghost"
            size="sm"
            onClick={() => setSaved(!saved)}
          >
            {saved ? <BookmarkFilled /> : <Bookmark />}
          </IconButton>
        </div>
        <p className="cds--productive-heading-03" style={{ marginBottom: "0.25rem" }}>
          {p.name}
        </p>
        <p style={{ fontSize: 12, color: "#6f6f6f", marginBottom: "0.5rem" }}>{p.category}</p>
        <p style={{ fontSize: 13, color: "#393939", lineHeight: 1.5, marginBottom: "0.75rem" }}>
          {p.description}
        </p>
        <StarRating value={p.rating} reviewCount={p.reviewCount} />
        <div style={{ margin: "1rem 0", borderTop: "1px solid #e0e0e0" }} />
        <div style={{ marginBottom: "1rem" }}>
          <span style={{ fontSize: 22, fontWeight: 600 }}>${(p.price * qty).toFixed(2)}</span>
          <span style={{ fontSize: 12, color: "#6f6f6f", textDecoration: "line-through", marginLeft: 8 }}>
            ${(p.originalPrice * qty).toFixed(2)}
          </span>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <StepperInput value={qty} onChange={setQty} />
          <Button renderIcon={ShoppingCart} style={{ flex: 1 }}>
            Add to cart
          </Button>
        </div>
      </div>
    </Tile>
  );
}

// ─── Variant 6 ────────────────────────────────────────────────────────────────

function Variant6({ p }: { p: Product }) {
  const [saved, setSaved] = useState(false);
  return (
    <Tile style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", height: 168 }}>
        <div style={{ width: 200, flexShrink: 0, background: p.imageBg }} />
        <div
          style={{
            display: "flex",
            flex: 1,
            padding: "1rem 1.25rem",
            justifyContent: "space-between",
            gap: "1.5rem",
            overflow: "hidden",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: "0.5rem" }}>
              <PillBadge variant="teal">New</PillBadge>
              <StockDot count={3} />
            </div>
            <p
              className="cds--productive-heading-03"
              style={{
                marginBottom: "0.2rem",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {p.name}
            </p>
            <p style={{ fontSize: 12, color: "#6f6f6f", marginBottom: "0.4rem" }}>{p.category}</p>
            <p
              style={{
                fontSize: 13,
                color: "#393939",
                lineHeight: 1.4,
                marginBottom: "0.6rem",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {p.description}
            </p>
            <StarRating value={p.rating} reviewCount={p.reviewCount} />
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              justifyContent: "space-between",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center" }}>
              <GhostIconBtn label={saved ? "Remove" : "Save"} onClick={() => setSaved(!saved)}>
                {saved ? <BookmarkFilled size={16} /> : <Bookmark size={16} />}
              </GhostIconBtn>
              <DropMenu items={["Compare", "Share", "View similar"]} />
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 22, fontWeight: 600 }}>${p.price}</div>
              <div
                style={{
                  fontSize: 12,
                  color: "#6f6f6f",
                  textDecoration: "line-through",
                  marginBottom: "0.5rem",
                }}
              >
                ${p.originalPrice}
              </div>
              <Button size="sm" renderIcon={ShoppingCart}>
                Add to cart
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Tile>
  );
}

// ─── Scene ────────────────────────────────────────────────────────────────────

export function ProductCardsDriftedScenario() {
  return (
    <Stack gap={7}>
      <p style={{ fontSize: 13, color: "#6f6f6f", maxWidth: 560 }}>
        Three additional product card variants built for different use cases.
      </p>

      <Grid>
        <Column lg={4} md={4} sm={4}>
          <p
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#6f6f6f",
              marginBottom: "0.75rem",
            }}
          >
            Variant 4 — Compact Detail
          </p>
          <Variant4 p={headphones} />
        </Column>

        <Column lg={5} md={4} sm={4}>
          <p
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#6f6f6f",
              marginBottom: "0.75rem",
            }}
          >
            Variant 5 — Promo
          </p>
          <Variant5 p={keyboard} />
        </Column>

        <Column lg={16} md={8} sm={4}>
          <p
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#6f6f6f",
              marginBottom: "0.75rem",
              marginTop: "2rem",
            }}
          >
            Variant 6 — List + Urgency
          </p>
          <Variant6 p={hub} />
        </Column>
      </Grid>
    </Stack>
  );
}
