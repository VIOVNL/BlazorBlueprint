using System.ComponentModel;
using BlazorBlueprint.Primitives.Utilities;
using Microsoft.JSInterop;

namespace BlazorBlueprint.Primitives.Services;

/// <summary>
/// Implementation of keyboard shortcut service using JavaScript interop for global keyboard handling.
/// </summary>
public class KeyboardShortcutService : IKeyboardShortcutService
{
    private readonly IJSRuntime _jsRuntime;
    private readonly Dictionary<string, ShortcutRegistration> _shortcuts = new();
    private readonly SemaphoreSlim _moduleLock = new(1, 1);
    private IJSObjectReference? _module;
    private DotNetObjectReference<KeyboardShortcutService>? _dotNetRef;
    private bool _suspended;
    private bool _disposed;
    private int _registrationCounter;

    /// <summary>
    /// Initializes a new instance of the <see cref="KeyboardShortcutService"/> class.
    /// </summary>
    /// <param name="jsRuntime">The JavaScript runtime for invoking keyboard handling functions.</param>
    public KeyboardShortcutService(IJSRuntime jsRuntime)
    {
        _jsRuntime = jsRuntime;
    }

    /// <inheritdoc />
    public bool IsSuspended => _suspended;

    /// <inheritdoc />
    public async Task<IDisposable> RegisterAsync(string shortcut, Func<Task> callback)
    {
        var id = $"shortcut_{Interlocked.Increment(ref _registrationCounter)}";
        return await RegisterAsync(shortcut, callback, id);
    }

    /// <inheritdoc />
    public async Task<IDisposable> RegisterAsync(string shortcut, Func<Task> callback, string id)
    {
        var parsed = KeyboardShortcut.Parse(shortcut);
        var normalizedKey = parsed.GetNormalizedKey();

        await _moduleLock.WaitAsync();
        try
        {
            if (_disposed)
            {
                return EmptyShortcutHandle.Instance;
            }

            await EnsureInitializedCoreAsync();

            // Register with the service
            var registration = new ShortcutRegistration(id, parsed, callback);
            _shortcuts[normalizedKey] = registration;

            // Register with JavaScript
            if (_module != null)
            {
                await _module.InvokeVoidAsync("registerShortcut", normalizedKey);
            }

            return new ShortcutHandle(this, normalizedKey, id);
        }
        finally
        {
            _moduleLock.Release();
        }
    }

    /// <inheritdoc />
    public void Unregister(string id)
    {
        var toRemove = _shortcuts.FirstOrDefault(kvp => kvp.Value.Id == id);
        if (toRemove.Key != null)
        {
            UnregisterInternal(toRemove.Key);
        }
    }

    /// <inheritdoc />
    public void Suspend() => _suspended = true;

    /// <inheritdoc />
    public void Resume() => _suspended = false;

    /// <summary>
    /// Called from JavaScript when a registered shortcut key is pressed.
    /// </summary>
    /// <param name="normalizedKey">The normalized key combination (e.g., "ctrl+n").</param>
    [JSInvokable]
    [EditorBrowsable(EditorBrowsableState.Never)]
    public async Task HandleShortcutAsync(string normalizedKey)
    {
        if (_suspended || _disposed)
        {
            return;
        }

        // Input validation - reject obviously invalid inputs
        if (string.IsNullOrWhiteSpace(normalizedKey) || normalizedKey.Length > 50)
        {
            return;
        }

        if (_shortcuts.TryGetValue(normalizedKey, out var registration))
        {
            try
            {
                await registration.Callback();
            }
            catch (Exception ex)
            {
                // Log or handle exception - don't let it propagate to JS
                Console.Error.WriteLine($"Error handling keyboard shortcut '{normalizedKey}': {ex.Message}");
            }
        }
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        await _moduleLock.WaitAsync();
        try
        {
            if (_disposed)
            {
                return;
            }

            GC.SuppressFinalize(this);
            _disposed = true;
            _shortcuts.Clear();

            if (_module != null)
            {
                try
                {
                    await _module.InvokeVoidAsync("dispose");
                    await _module.DisposeAsync();
                }
                catch
                {
                    // Module may already be disposed (e.g., during page navigation)
                }

                _module = null;
            }

            _dotNetRef?.Dispose();
            _dotNetRef = null;
        }
        finally
        {
            _moduleLock.Release();
        }
    }

    private async Task EnsureInitializedCoreAsync()
    {
        if (_module != null)
        {
            return;
        }

        _dotNetRef = DotNetObjectReference.Create(this);
        _module = await _jsRuntime.InvokeAsync<IJSObjectReference>(
            "import", "./_content/BlazorBlueprint.Primitives/js/primitives/keyboard-shortcuts.js");
        await _module.InvokeVoidAsync("initialize", _dotNetRef);
    }

    private void UnregisterInternal(string normalizedKey)
    {
        if (_shortcuts.Remove(normalizedKey) && _module != null)
        {
            // Fire-and-forget unregister from JS
            _ = _module.InvokeVoidAsync("unregisterShortcut", normalizedKey).AsTask();
        }
    }

    private sealed class ShortcutRegistration
    {
        public string Id { get; }
        public KeyboardShortcut Shortcut { get; }
        public Func<Task> Callback { get; }

        public ShortcutRegistration(string id, KeyboardShortcut shortcut, Func<Task> callback)
        {
            Id = id;
            Shortcut = shortcut;
            Callback = callback;
        }
    }

    private sealed class ShortcutHandle : IDisposable
    {
        private readonly KeyboardShortcutService _service;
        private readonly string _normalizedKey;
        private readonly string _id;
        private bool _disposed;

        public ShortcutHandle(KeyboardShortcutService service, string normalizedKey, string id)
        {
            _service = service;
            _normalizedKey = normalizedKey;
            _id = id;
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;

            if (!_service._disposed)
            {
                _service.UnregisterInternal(_normalizedKey);
            }
        }
    }

    private sealed class EmptyShortcutHandle : IDisposable
    {
        public static EmptyShortcutHandle Instance { get; } = new();

        public void Dispose()
        {
        }
    }
}
