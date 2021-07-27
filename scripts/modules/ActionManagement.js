import { MODULE } from '../module.js';
import { logger } from '../logger.js';

const NAME = "ActionManagement";

/**
 * ActionManagement
 *  This Module strictly manages token action economy per the dnd5e rules.
 */
export class ActionManagement{
  static register(){
    logger.info("Registering Action Management");
    this.defaults();
    this.settings();
    this.hooks();
    this.patch();
    this.globals();
  }

  static async defaults(){
    MODULE[NAME] = {
      /* Sub Module Constant Values */
      flagKey : "ActionManagement",
      default : {
        action : 0, reaction : 0, bonus : 0
      },
      img : {
        action : "modules/dnd5e-helpers/assets/action-markers/ACTION2.png",
        reaction : "modules/dnd5e-helpers/assets/action-markers/reaction.png",
        bonus : "modules/dnd5e-helpers/assets/action-markers/bonus.png",
        background : "modules/dnd5e-helpers/assets/action-markers/background.png",
      },
      orig : {
        height : 150, width : 150, x : 0, y : 0,
      }, 
      offset : {
        action : { h : 5, v : -1},
        reaction : { h : 2, v : -1},
        bonus : { h : 8, v : -1},
        background : { h : 5, v : -1}
      }
    };
  }

  static settings(){
    const config = false;
    const settingData = {
      cbtReactionEnable : {
        scope : "world", type : Number, group : "combat", default : 0, config,
        choices : {
          0 : MODULE.localize("option.default.none"),
          1 : MODULE.localize("option.default.enabled"),
          2 : MODULE.localize("option.enabled.displaySuppressed"),
        },
        onChange : async (v) =>{
          /**
           * @todo deal with updates based on rapid changes.
           */
        },
      }
      /**
       * @todo add new setting to handle container location
       * @todo add new setting for click handler (and dialog availability)
       */
    };

    MODULE.applySettings(settingData);

    /*
      additional settings
    */
  }

  static hooks(){
    Hooks.on(`updateCombat`, ActionManagement._updateCombat);
    Hooks.on(`controlToken`, ActionManagement._controlToken);
    Hooks.on(`updateToken`, ActionManagement._updateToken);
    Hooks.on(`preCreateChatMessage`, ActionManagement._preCreateChatMessage);
    Hooks.on(`deleteCombat`, ActionManagement._deleteCombat);
  }

  static patch(){
    this._patchToken();
  }

  static globals(){

  }

  /**
   * Hook Functions
   */
  static async _updateCombat(combat, changed, /*options, userid*/){
    if(MODULE.setting('cbtReactionEnable') == 0) return;

    logger.debug("_updateCombat | DATA | ", { 
      isFirstTurn : MODULE.isFirstTurn(combat,changed),
      isTurnChange : MODULE.isTurnChange(combat, changed),
      isFirstGM : MODULE.isFirstGM(),
      isFirstOwner : MODULE.isFirstOwner(combat.combatant.token.actor),
      combat,
      changed,
    });

    if(MODULE.isFirstTurn(combat, changed) && MODULE.isFirstGM())
      for(let combatant of combat.combatants){
        const token = combatant.token.object;
        await token.resetActionFlag();
        await token.renderActionContainer(combatant.token.object._controlled);
      }
    
    if(MODULE.isTurnChange(combat, changed) && MODULE.isFirstOwner(combat.combatant.token.actor)){
      await combat.combatant.token.object.resetActionFlag();
    }
  }

  static async _deleteCombat(combat, /* options, userId */){
    const mode = MODULE.setting('cbtReactionEnable');
    if(mode == 0) return;

    for(const combatant of combat.combatants){
      const token = combatant.token.object;

      if(token.hasActionContainer()) await token.removeActionContainer();
      if(token.hasActionFlag()) await token.removeActionFlag();
    }
  }

  static _controlToken(token, state){
    const mode = MODULE.setting('cbtReactionEnable');
    if(mode == 0) return;

    if(token.inCombat){
      if(token.hasActionContainer()) token.toggleActionContainer(mode === 2 || !state ? false : true);
      else ActionManagement._renderActionContainer(token, mode === 2 || !state ? false : true);
    }
  }

  static _updateToken(tokenDocument, update, /* options, id */){
    const mode = MODULE.setting('cbtReactionEnable');
    if(mode == 0 || !tokenDocument.inCombat) return;

    if("width" in update || "height" in update || "scale" in update){
      ActionManagement._renderActionContainer(tokenDocument.object, mode === 2 || !tokenDocument.object._controlled ? false : true );
    }

    if("tint" in update || "img" in update || "flags" in update)
      tokenDocument.object.updateActionMarkers();
      
    logger.debug("_updateToken | Data | ", {
      tokenDocument, mode, update, container : tokenDocument.object.getActionContainer(),
    });
  }

  static async _preCreateChatMessage(messageDocument, messageData, /*options, userId*/){
    const types = Object.keys(MODULE[NAME].default);
    const speaker = messageData.speaker;

    logger.debug("_preCreateChatMessage | DATA | ", {
      types, speaker, messageData,
    });

    if(!speaker.scene || !speaker.token || !game.combats.reduce((a,c) => a || c.started, false)) return;

    const item_id = $(messageData.content).attr("data-item-id");
    const token = await fromUuid(`Scene.${speaker.scene}.Token.${speaker.token}`);

    logger.debug("_preCreateChatMessage | DATA | ", {
      item_id, token,
    });

    if(!item_id || !token || !MODULE.isFirstOwner(token.actor)) return;

    const item = token.actor.items.get(item_id);

    logger.debug("_preCreateChatMessage | DATA | ", {
      item,
    });

    if(!item || !types.includes(item.data.data.activation.type)) return;
    const type = item.data.data.activation.type;
    
    logger.debug("_preCreateChatMessage | DATA | ", {
      type,
    });

    await token.object.iterateActionFlag(type);
  }

  /**
   * Patching Functions
   */
  static _patchToken(){
    Token.prototype.hasActionContainer = function(){
      return !!this.children?.find(i => i[NAME]);
    }

    Token.prototype.toggleActionContainer = function(state){
      let container = this.getActionContainer();
      if(container) container.visible = state === undefined ? !container.visible : state;
    }

    Token.prototype.getActionContainer = function(){
      return this.children?.find(i => i[NAME]);
    }

    Token.prototype.updateActionMarkers = function(){
      const flag = this.getActionFlag();
      const container = this.getActionContainer();

      if(!container || !flag) return;

      for(const type of Object.keys(MODULE[NAME].default)){
        const element = container.children.find(e => e.actionType == type);
        if(flag[type] > 0)
          element.alpha = 0.2;
        else
          element.alpha = 1;
      }
    }

    Token.prototype.getActionFlag = function(){
      return this.document.getFlag(MODULE.data.name, MODULE[NAME].flagKey);
    }

    Token.prototype.hasActionFlag = function(){
      return !!this.getActionFlag();
    }

    Token.prototype.iterateActionFlag = async function(type, value){
      let flag = this.getActionFlag() ?? MODULE[NAME].default;
      if(value === undefined) flag[type] += 1;
      else flag[type] = value;

      logger.debug("iterateActionFlag | DATA | ", {
        type, flag, token : this, scope : MODULE.data.name, key : MODULE[NAME].flagKey,
      });

      return await this.document.setFlag(MODULE.data.name, MODULE[NAME].flagKey, flag);
    }

    Token.prototype.resetActionFlag = async function(){
      logger.debug("resetActionFlag | DATA | ", {
        token : this, default : MODULE[NAME].default,
      });

      return await this.document.setFlag(MODULE.data.name, MODULE[NAME].flagKey, MODULE[NAME].default);
    }

    Token.prototype.removeActionContainer = function(){
      if(this.hasActionContainer()) return this.removeChild(this.getActionContainer());
    }

    Token.prototype.removeActionFlag = async function(){
      if(!!this.getActionFlag()) return this.document.update({[`flags.${MODULE.data.name}.-=${MODULE[NAME].flagKey}`] : null });
    }

    Token.prototype.renderActionContainer = function(state){
      if(this.hasActionContainer())
        return this.toggleActionContainer(state);
      else
        return ActionManagement._renderActionContainer(this, state);
    }
  }

  /**
   * Global Accessor Functions
   */

  /**
   * Module Specific Functions
   */
  static async _loadTextures(orig, obj = {}){
    const textures = {};
    for(let [k,v] of Object.entries(obj)){
      let t = await loadTexture(v);
      if(k !== "background") t.orig = orig;
      textures[k] = t;
    }
    return textures;
  }

  static async _renderActionContainer(token, state){
    /* Define Constants */
    const actions = token.getActionFlag() ?? MODULE[NAME].default;
    const container = new PIXI.Container();
    const size = token.h, hAlign = token.w / 10, vAlign = token.h / 5, scale = 1/ (600/size);

    /* Build Textures, Sprites, Icons, and Container */
    container.setParent(token);
    container.sortableChildren = true;
    container[NAME] = true;
    container.visible = state;

    const textures = await ActionManagement._loadTextures(MODULE[NAME].orig, MODULE[NAME].img)

    for(let [k, v] of Object.entries(textures)){
      let s = new PIXI.Sprite(v);
      s.anchor.set(0.5);
      s.scale.set(scale);
      s.position.set(hAlign * MODULE[NAME].offset[k].h, vAlign /* MODULE[NAME].offset[k].v*/);
    
      if(k !== "background"){
        s.interactive = true;
        s.buttonMode = true;
        s.actionType = k;
        s.tint = 13421772;
        s.alpha = actions[k] === 0 ? 1 : 0.2;
        s.on("mousedown", (event) => {
          const actions = token.getActionFlag();
          const container = token.getActionContainer();
          if(actions && container.visible)
            token.iterateActionFlag(k, actions[k] == 0 ? 1 : 0);
          logger.debug("_MouseDown | DATA |", { 
            event, token, container, actions
          });
        });
      }else{
        s.zIndex = -1000;
      }
      
      let i = container.addChild(s);

      logger.debug("_renderAction Container", {
        s, i, k, v
      });
    }

    logger.debug("_renderActionContainer | DATA | ", {
      actions, container, textures, token, state, size, hAlign, vAlign, scale
    });

    /* return Container*/
    return container;
  }
}