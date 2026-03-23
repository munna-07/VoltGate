package pipeline

import (
	"context"
	"net/http"

	voltgateauth "github.com/voltgate/voltgate/v6/sdk/voltgate/auth"
	voltgateexecutor "github.com/voltgate/voltgate/v6/sdk/voltgate/executor"
	sdktranslator "github.com/voltgate/voltgate/v6/sdk/translator"
)

// Context encapsulates execution state shared across middleware, translators, and executors.
type Context struct {
	// Request encapsulates the provider facing request payload.
	Request voltgateexecutor.Request
	// Options carries execution flags (streaming, headers, etc.).
	Options voltgateexecutor.Options
	// Auth references the credential selected for execution.
	Auth *voltgateauth.Auth
	// Translator represents the pipeline responsible for schema adaptation.
	Translator *sdktranslator.Pipeline
	// HTTPClient allows middleware to customise the outbound transport per request.
	HTTPClient *http.Client
}

// Hook captures middleware callbacks around execution.
type Hook interface {
	BeforeExecute(ctx context.Context, execCtx *Context)
	AfterExecute(ctx context.Context, execCtx *Context, resp voltgateexecutor.Response, err error)
	OnStreamChunk(ctx context.Context, execCtx *Context, chunk voltgateexecutor.StreamChunk)
}

// HookFunc aggregates optional hook implementations.
type HookFunc struct {
	Before func(context.Context, *Context)
	After  func(context.Context, *Context, voltgateexecutor.Response, error)
	Stream func(context.Context, *Context, voltgateexecutor.StreamChunk)
}

// BeforeExecute implements Hook.
func (h HookFunc) BeforeExecute(ctx context.Context, execCtx *Context) {
	if h.Before != nil {
		h.Before(ctx, execCtx)
	}
}

// AfterExecute implements Hook.
func (h HookFunc) AfterExecute(ctx context.Context, execCtx *Context, resp voltgateexecutor.Response, err error) {
	if h.After != nil {
		h.After(ctx, execCtx, resp, err)
	}
}

// OnStreamChunk implements Hook.
func (h HookFunc) OnStreamChunk(ctx context.Context, execCtx *Context, chunk voltgateexecutor.StreamChunk) {
	if h.Stream != nil {
		h.Stream(ctx, execCtx, chunk)
	}
}

// RoundTripperProvider allows injection of custom HTTP transports per auth entry.
type RoundTripperProvider interface {
	RoundTripperFor(auth *voltgateauth.Auth) http.RoundTripper
}
