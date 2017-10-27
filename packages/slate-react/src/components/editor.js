
import Debug from 'debug'
import Portal from 'react-portal'
import React from 'react'
import SlateTypes from 'slate-prop-types'
import Types from 'prop-types'
import logger from 'slate-dev-logger'
import { Schema, Stack, Value } from 'slate'

import EVENT_HANDLERS from '../constants/event-handlers'
import PLUGINS_PROPS from '../constants/plugin-props'
import AfterPlugin from '../plugins/after'
import BeforePlugin from '../plugins/before'
import noop from '../utils/noop'

/**
 * Debug.
 *
 * @type {Function}
 */

const debug = Debug('slate:editor')

/**
 * Editor.
 *
 * @type {Component}
 */

class Editor extends React.Component {

  /**
   * Property types.
   *
   * @type {Object}
   */

  static propTypes = {
    autoCorrect: Types.bool,
    autoFocus: Types.bool,
    className: Types.string,
    onChange: Types.func,
    placeholder: Types.any,
    placeholderClassName: Types.string,
    placeholderStyle: Types.object,
    plugins: Types.array,
    readOnly: Types.bool,
    role: Types.string,
    schema: Types.object,
    spellCheck: Types.bool,
    style: Types.object,
    tabIndex: Types.number,
    value: SlateTypes.value.isRequired,
  }

  /**
   * Default properties.
   *
   * @type {Object}
   */

  static defaultProps = {
    autoFocus: false,
    autoCorrect: true,
    onChange: noop,
    plugins: [],
    readOnly: false,
    schema: {},
    spellCheck: true,
  }

  /**
   * Constructor.
   *
   * @param {Object} props
   */

  constructor(props) {
    super(props)
    this.state = {}
    this.tmp = {}
    this.tmp.updates = 0
    this.tmp.resolves = 0

    let { value } = props

    if (!value && props.state) {
      logger.deprecate('slate-react@0.9.0', 'The `props.state` prop has been renamed to `props.value`.')
      value = props.state
    }

    // Resolve the plugins and create a stack and schema from them.
    const plugins = this.resolvePlugins(props.plugins, props.schema)
    const stack = Stack.create({ plugins })
    const schema = Schema.create({ plugins })
    this.state.schema = schema
    this.state.stack = stack

    // Run `onChange` on the passed-in value because we need to ensure that it
    // is normalized, and queue the resulting change.
    const change = value.change()
    stack.run('onChange', change, this)
    this.queueChange(change)
    this.cacheValue(change.value)
    this.state.value = change.value

    // Create a bound event handler for each event.
    EVENT_HANDLERS.forEach((handler) => {
      this[handler] = (...args) => {
        this.onEvent(handler, ...args)
      }
    })

    if (props.onDocumentChange) {
      logger.deprecate('0.22.10', 'The `onDocumentChange` prop is deprecated because it led to confusing UX issues, see https://github.com/ianstormtaylor/slate/issues/614#issuecomment-327868679')
    }

    if (props.onSelectionChange) {
      logger.deprecate('0.22.10', 'The `onSelectionChange` prop is deprecated because it led to confusing UX issues, see https://github.com/ianstormtaylor/slate/issues/614#issuecomment-327868679')
    }
  }

  /**
   * When the `props` are updated, create a new `Stack` if necessary and run
   * `onChange` to ensure the value is normalized.
   *
   * @param {Object} props
   */

  componentWillReceiveProps = (props) => {
    let { value } = props
    let { schema, stack } = this.state

    if (!value && props.state) {
      logger.deprecate('slate-react@0.9.0', 'The `props.state` prop has been renamed to `props.value`.')
      value = props.state
    }

    // Increment the updates counter as a baseline.
    this.tmp.updates++

    // If the plugins or the schema have changed, we need to re-resolve the
    // plugins, since it will result in a new stack and new validations.
    if (props.plugins != this.props.plugins || props.schema != this.props.schema) {
      const plugins = this.resolvePlugins(props.plugins, props.schema)
      stack = Stack.create({ plugins })
      schema = Schema.create({ plugins })
      this.setState({ schema, stack })

      // Increment the resolves counter.
      this.tmp.resolves++

      // If we've resolved a few times already, and it's exactly in line with
      // the updates, then warn the user that they may be doing something wrong.
      if (this.tmp.resolves > 5 && this.tmp.resolves == this.tmp.updates) {
        logger.warn('A Slate <Editor> is re-resolving its `plugins` or `schema` on each update, which leads to poor performance. This is often due to passing in a new `schema` or `plugins` prop with each render, by declaring them inline in your render function. Do not do this!')
      }
    }

    // Run `onChange` on the passed-in value because we need to ensure that it
    // is normalized, and queue the resulting change.
    const change = value.change()
    stack.run('onChange', change, this)
    this.queueChange(change)
    this.cacheValue(change.value)
    this.setState({ value: change.value })
  }

  /**
   * When the component first mounts, flush any temporary changes.
   */

  componentDidMount = () => {
    this.flushChange()
  }

  /**
   * When the component updates, flush any temporary change.
   */

  componentDidUpdate = () => {
    this.flushChange()
  }

  /**
   * Cache a `value` object to be able to compare against it later.
   *
   * @param {Value} value
   */

  cacheValue = (value) => {
    this.tmp.document = value.document
    this.tmp.selection = value.selection
  }

  /**
   * Queue a `change` object, to be able to flush it later. This is required for
   * when a change needs to be applied to the value, but because of the React
   * lifecycle we can't apply that change immediately. So we cache it here and
   * later can call `this.flushChange()` to flush it.
   *
   * @param {Change} change
   */

  queueChange = (change) => {
    if (change.operations.length) {
      debug('queueChange', { change })
      this.tmp.change = change
    }
  }

  /**
   * Flush a temporarily stored `change` object, for when a change needed to be
   * made but couldn't because of React's lifecycle.
   */

  flushChange = () => {
    const { change } = this.tmp

    if (change) {
      debug('flushChange', { change })
      window.requestAnimationFrame(() => {
        delete this.tmp.change
        this.props.onChange(change)
      })
    }
  }

  /**
   * Perform a change on the editor, passing `...args` to `change.call`.
   *
   * @param {Mixed} ...args
   */

  change = (...args) => {
    const change = this.value.change().call(...args)
    this.onChange(change)
  }

  /**
   * Programmatically blur the editor.
   */

  blur = () => {
    this.change(c => c.blur())
  }

  /**
   * Programmatically focus the editor.
   */

  focus = () => {
    this.change(c => c.focus())
  }

  /**
   * Getters for exposing public properties of the editor's state.
   */

  get schema() {
    return this.state.schema
  }

  get stack() {
    return this.state.stack
  }

  get value() {
    return this.state.value
  }

  /**
   * Get the editor's current schema.
   *
   * @return {Schema}
   */

  getSchema = () => {
    logger.deprecate('slate-react@0.9.0', 'The `editor.getSchema()` method has been deprecated, use the `editor.schema` property getter instead.')
    return this.schema
  }

  /**
   * Get the editor's current stack.
   *
   * @return {Stack}
   */

  getStack = () => {
    logger.deprecate('slate-react@0.9.0', 'The `editor.getStack()` method has been deprecated, use the `editor.stack` property getter instead.')
    return this.stack
  }

  /**
   * Get the editor's current value.
   *
   * @return {Value}
   */

  getState = () => {
    logger.deprecate('slate-react@0.9.0', 'The `editor.getState()` method has been deprecated, use the `editor.value` property getter instead.')
    return this.value
  }

  /**
   * On event.
   *
   * @param {String} handler
   * @param {Event} event
   */

  onEvent = (handler, event) => {
    this.change((change) => {
      this.stack.run(handler, event, change, this)
    })
  }

  /**
   * On change.
   *
   * @param {Change} change
   */

  onChange = (change) => {
    debug('onChange', { change })

    if (Value.isValue(change)) {
      throw new Error('As of slate@0.22.0 the `editor.onChange` method must be passed a `Change` object not a `Value` object.')
    }

    this.stack.run('onChange', change, this)

    const { value } = change
    const { document, selection } = this.tmp
    const { onChange, onDocumentChange, onSelectionChange } = this.props
    if (value == this.value) return

    onChange(change)
    if (onDocumentChange && value.document != document) onDocumentChange(value.document, change)
    if (onSelectionChange && value.selection != selection) onSelectionChange(value.selection, change)
  }

  /**
   * Render the editor.
   *
   * @return {Element}
   */

  render() {
    debug('render', this)

    const children = this.stack
      .map('renderPortal', this.value, this)
      .map((child, i) => <Portal key={i} isOpened>{child}</Portal>)

    const props = { ...this.props, children }
    const tree = this.stack.render('renderEditor', props, this.value, this)
    return tree
  }

  /**
   * Resolve an array of plugins from `plugins` and `schema` props.
   *
   * In addition to the plugins provided in props, this will initialize three
   * other plugins:
   *
   * - The top-level editor plugin, which allows for top-level handlers, etc.
   * - The two "core" plugins, one before all the other and one after.
   *
   * @param {Array|Void} plugins
   * @param {Schema|Object|Void} schema
   * @return {Array}
   */

  resolvePlugins = (plugins, schema) => {
    const beforePlugin = BeforePlugin()
    const afterPlugin = AfterPlugin()
    const editorPlugin = {
      schema: schema || {}
    }

    for (const prop of PLUGINS_PROPS) {
      // Skip `onChange` because the editor's `onChange` is special.
      if (prop == 'onChange') continue

      // Skip `schema` because it can't be proxied easily, so it must be
      // passed in as an argument to this function instead.
      if (prop == 'schema') continue

      // Define a function that will just proxies into `props`.
      editorPlugin[prop] = (...args) => {
        return this.props[prop] && this.props[prop](...args)
      }
    }

    return [
      beforePlugin,
      editorPlugin,
      ...(plugins || []),
      afterPlugin
    ]
  }

}


/**
 * Mix in the property types for the event handlers.
 */

for (const prop of EVENT_HANDLERS) {
  Editor.propTypes[prop] = Types.func
}

/**
 * Export.
 *
 * @type {Component}
 */

export default Editor
